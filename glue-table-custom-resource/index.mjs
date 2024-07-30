'use strict';
/**
 * Lambda that takes a RAM resource share arn, extracts shared Glue tables from it, and creates corresponding tables in this account/region.
 **/
import https from "https";
import url from "url";
import {
    RAMClient,
    ListResourcesCommand
} from "@aws-sdk/client-ram";
import {
    LakeFormationClient,
    GrantPermissionsCommand,
    PutDataLakeSettingsCommand,
    GetDataLakeSettingsCommand
} from "@aws-sdk/client-lakeformation";
import {
    ACCOUNT_ID_FROM_STACK_REGEX,
    DATABASE_NAME_CAPTURE_REGEX,
    RESOURCE_SHARE_ARN_REGEX
} from "./constant.mjs";

export async function handler(event, context) {
    console.log("REQUEST RECEIVED.");
    if (event.RequestType === "Update") {
        const reason = "RequestType is Update which is not supported.";
        console.error(reason);
        await sendResponse(event, context, "FAILED", reason);
        return;
    }

    let result;
    let reason;
    if (event.RequestType === "Create") {
        [result, reason] = await startCreate(event, context);
    } else if (event.RequestType === "Delete") {
        // For Delete requests, immediately send a SUCCESS response.
        result = "SUCCESS";
    } else {
        reason = "Unrecognized cloudformation request type received. This custom resource only supports creation and deletion.";
        console.error(reason);
        result = "FAILED";
    }
    await sendResponse(event, context, result, reason);
}

async function startCreate(event, context) {
    try {
        console.log("Start attaching Lake Formation permissions..");
        const resourceShareArn = getResourceShareArn(event);
        const currentRegion = process.env.AWS_REGION;
        const [ramClient, lakeFormationClient] = buildClients(currentRegion);
        const lakeformationDataLakePrincipals = getLakeFormationDataLakePrincipals(event);
        const databaseName = await getDatabaseName(ramClient, resourceShareArn);
        const existingDataLakeSettings = await getLakeFormationDataLakeSettings(lakeFormationClient);
        const newDataLakeSettings = buildDataLakeSettings(existingDataLakeSettings, lakeformationDataLakePrincipals);
        const currentCallerIdentityArn = await getCurrentCallerIdentityArn(event);
        // Add current caller identity to Lake Formation DataLake admins temporarily
        // in order to grant Lake Formation permission to lakeformationDataLakePrincipals.
        const temporaryDataLakeSettings = buildDataLakeSettings(newDataLakeSettings, [currentCallerIdentityArn]);

        console.log(`Adding lambda role ${currentCallerIdentityArn} and LakeFormation principals into LakeFormation DataLakeAdmins...`);
        await setLakeFormationDataLakeSettings(lakeFormationClient, temporaryDataLakeSettings);
        console.log("Granting LakeFormation permission to LakeFormation principals...");
        await grantLakeFormationPermission(lakeFormationClient, databaseName, lakeformationDataLakePrincipals)
        console.log(`Permission granted. Removing lambda role ${currentCallerIdentityArn} from LakeFormation DataLakeAdmins...`);
        await setLakeFormationDataLakeSettings(lakeFormationClient, newDataLakeSettings);
        return ["SUCCESS", undefined];
    } catch (exception) {
        console.error(exception);
        return ["FAILED", exception];
    }
}

function getResourceShareArn(event) {
    const resourceShareArn = event.ResourceProperties.ResourceShareArn;
    validateResourceShareArn(resourceShareArn);
    console.log(`Resource share arn: ${resourceShareArn}`);
    return resourceShareArn;
}

function validateResourceShareArn(arn) {
    const resourceShareRegex = new RegExp(RESOURCE_SHARE_ARN_REGEX);
    if(!resourceShareRegex.test(arn)) {
        throw new Error("Invalid ResourceShareArn.");
    }
}

function getLakeFormationDataLakePrincipals(event) {
    const principals = event.ResourceProperties.LakeFormationPrincipals;
    const accountId = getAccountId(event.StackId);
    validatePrincipals(principals, accountId);
    // deduplication
    const uniquePrincipals = [...new Set(principals)];
    console.log(`LakeFormation principals: ${JSON.stringify(uniquePrincipals)}`);
    return uniquePrincipals;
}

function getAccountId(stackId) {
    const captured = ACCOUNT_ID_FROM_STACK_REGEX.exec(stackId);
    if (!captured || captured.length < 2) {
        throw new Error("Could not parse account id from stack ID.");
    }
    const accountId = captured[1];
    console.log(`Account id: ${accountId}`);
    return accountId;
}

function buildClients(resourceShareRegion) {
    const ramClient = new RAMClient({
        region: resourceShareRegion
    });
    const lakeFormationClient = new LakeFormationClient({
        region: resourceShareRegion
    });
    return [ramClient, lakeFormationClient];
}

function validatePrincipals(principals, accountId) {
    if (!Array.isArray(principals)) {
        throw new Error("LakeFormationPrincipals is not an array.");
    }
    for (const principal of principals) {
        validateIAMPrincipal(principal, accountId);
    }
}

function validateIAMPrincipal(principal, accountId) {
    console.log("Validating LakeFormationPrincipals...");
    const iamPrincipalRegex = new RegExp(`arn:aws[-\w]{0,10}?:iam::${accountId}:.+`);
    if(!iamPrincipalRegex.test(principal)) {
        throw new Error(`Invalid IAM principal, or IAM principal does not belong to account ${accountId}.`);
    }
}

/**
 * Get database shared in this resource share arn.
 * Throws error if no database is found.
 */
async function getDatabaseName(ramClient, resourceShareArn) {
    const databaseArn = await getDatabaseNameArn(ramClient, resourceShareArn);
    const captured = DATABASE_NAME_CAPTURE_REGEX.exec(databaseArn);
    if (!captured || captured.length < 2) {
        throw new Error("Could not parse database from database arn.");
    }
    const databaseName = captured[1];
    console.log(`Database name: ${databaseName}`);
    return databaseName;
}

async function getDatabaseNameArn(ramClient, resourceShareArn) {
    const response = await ramClient.send(new ListResourcesCommand({
        resourceOwner: "OTHER-ACCOUNTS",
        resourceShareArns: [resourceShareArn],
        resourceType: "glue:database"
    }))
    if (response.resources.length === 0) {
        throw new Error("Found no database associated with resource share ARN.")
    }
    return response.resources[0].arn;
}

/**
 * Set Lake Formation DataLakeSettings.
 */
async function setLakeFormationDataLakeSettings(lakeFormationClient, dataLakeSettings) {
    const input = { // PutDataLakeSettingsRequest
        DataLakeSettings: dataLakeSettings,
    };
    const command = new PutDataLakeSettingsCommand(input);
    await lakeFormationClient.send(command);
}

/**
 * Given existingDataLakeSettings, build a new dataLakeSettings containing iamPrincipals and return it.
 */
function buildDataLakeSettings(existingDataLakeSettings, iamPrincipals) {
    const newDatalakeAdmins = buildDataLakeAdmins(existingDataLakeSettings.DataLakeAdmins, iamPrincipals);
    return {
        ...existingDataLakeSettings,
        DataLakeAdmins: newDatalakeAdmins
    };
}

/**
 * Build a new DataLake admins by adding iamPrincipals into existingDataLakeAdmins.
 */
function buildDataLakeAdmins(existingDataLakeAdmins, iamPrincipals) {
    const existingPrincipals = existingDataLakeAdmins.map(admin => admin.DataLakePrincipalIdentifier);
    const newPrincipals = [...new Set([...existingPrincipals, ...iamPrincipals])];
    return newPrincipals.map((principal) => {
        return {
            DataLakePrincipalIdentifier: principal
        };
    });
}

async function getLakeFormationDataLakeSettings(lakeFormationClient) {
    const command = new GetDataLakeSettingsCommand({});
    const response = await lakeFormationClient.send(command);
    return response.DataLakeSettings;
}

/**
 * Grant lake formation SELECT permission to every table under databaseName.
 */
async function grantLakeFormationPermission(lakeFormationClient, databaseName, principals) {
    for (const principal of principals) {
        const input = { // GrantPermissionsRequest
            Principal: { // DataLakePrincipal
                DataLakePrincipalIdentifier: principal,
            },
            Resource: { // Resource
                Table: { // TableResource
                    DatabaseName: databaseName,
                    TableWildcard: {},
                }
            },
            Permissions: ["SELECT"]
        };
        const command = new GrantPermissionsCommand(input);
        await lakeFormationClient.send(command);
    }
}

async function getCurrentCallerIdentityArn(event) {
    const currentCallerIdentityArn = event.ResourceProperties.LambdaRoleArn;
    console.info(`Current caller: ${currentCallerIdentityArn}`);
    return currentCallerIdentityArn;
}

// Send response to the pre-signed S3 URL
async function sendResponse(event, context, responseStatus, reason) {
    return new Promise((resolve, reject) => {
        const responseBody = JSON.stringify({
            Status: responseStatus,
            Reason: composeReason(context, reason),
            PhysicalResourceId: context.logStreamName,
            StackId: event.StackId,
            RequestId: event.RequestId,
            LogicalResourceId: event.LogicalResourceId,
            Data: {}
        });

        console.log("RESPONSE BODY:\n", responseBody);

        const parsedUrl = url.parse(event.ResponseURL);
        const options = {
            hostname: parsedUrl.hostname,
            port: 443,
            path: parsedUrl.path,
            method: "PUT",
            headers: {
                "content-type": "",
                "content-length": responseBody.length
            }
        };

        console.log("SENDING RESPONSE...\n");

        const request = https.request(options, function (response) {
            // Tell AWS Lambda that the function execution is done
            context.done();
            resolve();
        });

        request.on("error", function (error) {
            console.error("sendResponse Error:" + error);
            // Tell AWS Lambda that the function execution is done
            context.done();
            resolve();
        });

        // write data to request body
        request.write(responseBody);
        request.end();
    });
}

function composeReason(context, reason) {
    const region = process.env.AWS_REGION;
    const cwLogUrl = `https://console.aws.amazon.com/cloudwatch/home?region=${region}#logEventViewer:group=${context.logGroupName};stream=${context.logStreamName}`;
    const cwLogStreamMessage = `See the details in CloudWatch Log Stream: ${cwLogUrl}`;
    return reason ? `${reason} ${cwLogStreamMessage}` : `${cwLogStreamMessage}`;
}
