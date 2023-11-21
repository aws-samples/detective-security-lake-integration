'use strict';
/**
 * Lambda that takes a RAM resource share arn and some other inputs, list out the database and table names in it and update
 * SSM (Systems Manager) parameters accordingly.
 **/
import https from "https";
import url from "url";
import {
    SSMClient,
    PutParameterCommand,
    DeleteParametersCommand,
    ParameterAlreadyExists,
    GetParameterCommand
} from "@aws-sdk/client-ssm";
import {
    RAMClient,
    ListResourcesCommand
} from "@aws-sdk/client-ram";
import {
    RESOURCE_SHARE_ARN_PARAMETER,
    ATHENA_RESULT_BUCKET_PARAMETER,
    DATABASE_NAME_PARAMETER,
    TABLE_NAMES_PARAMETER,
    STACK_ID_PARAMETER,
    DATABASE_NAME_CAPTURE_REGEX,
    TABLE_NAME_CAPTURE_REGEX
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
        [result, reason] = await createParameters(event, context);
    } else if (event.RequestType === "Delete") {
        [result, reason] = await deleteParameters(event, context);
    } else {
        reason = `Received unknown RequestType ${event.RequestType}.`;
        console.error(reason);
        result = "FAILED";
    }
    await sendResponse(event, context, result, reason);
}

async function createParameters(event, context) {
    try {
        console.log("Creating parameters..");
        const resourceShareArn = getResourceShareArn(event);
        const resourceShareRegion = getResourceShareRegion(resourceShareArn)
        const dtRegion = getDTRegion(event);
        const athenaResultBucket = getAthenaResultBucket(event);
        const stackId = getStackId(event);
        const ramClient = new RAMClient({
            region: resourceShareRegion
        })
        const databaseName = await getDatabaseName(ramClient, resourceShareArn);
        const tableNameList = await getTableNames(ramClient, resourceShareArn);
        const ssmClient = new SSMClient({
            region: dtRegion
        });
        await saveParameter(ssmClient, STACK_ID_PARAMETER, stackId);
        await saveParameter(ssmClient, RESOURCE_SHARE_ARN_PARAMETER, resourceShareArn);
        await saveParameter(ssmClient, ATHENA_RESULT_BUCKET_PARAMETER, athenaResultBucket);
        await saveParameter(ssmClient, DATABASE_NAME_PARAMETER, databaseName);
        await saveParameter(ssmClient, TABLE_NAMES_PARAMETER, tableNameList.join(","));
        return ["SUCCESS", undefined];
    } catch (exception) {
        console.error(exception);
        return ["FAILED", exception];
    }
}

async function deleteParameters(event, context) {
    try {
        const parametersToDelete = [
            STACK_ID_PARAMETER.Name,
            RESOURCE_SHARE_ARN_PARAMETER.Name,
            ATHENA_RESULT_BUCKET_PARAMETER.Name,
            DATABASE_NAME_PARAMETER.Name,
            TABLE_NAMES_PARAMETER.Name
        ];
        console.log(`Deleting parameters ${JSON.stringify(parametersToDelete)}..`);
        const dtRegion = getDTRegion(event);
        const ssmClient = new SSMClient({
            region: dtRegion
        });
        await deleteSSMParameters(ssmClient, parametersToDelete);
        return ["SUCCESS", undefined];
    } catch (exception) {
        console.error(exception);
        return ["FAILED", exception];
    }
}

async function deleteSSMParameters(ssmClient, parameterNames) {
    const input = { // DeleteParametersRequest
        Names: parameterNames,
    };
    const command = new DeleteParametersCommand(input);
    await ssmClient.send(command);
}

function getResourceShareArn(event) {
    const resourceShareArn = event.ResourceProperties.ResourceShareArn;
    validateResourceShareArn(resourceShareArn);
    console.log(`resource share arn: ${resourceShareArn}`);
    return resourceShareArn;
}

function validateResourceShareArn(arn) {
    const resourceShareRegex = new RegExp(RESOURCE_SHARE_ARN_PARAMETER.AllowedPattern);
    if(!resourceShareRegex.test(arn)) {
        throw new Error("Invalid ResourceShareArn.");
    }
}

function getResourceShareRegion(resourceShareArn) {
    const captured = /^arn:aws[-\w]{0,10}?:ram:([^:]+):.+/.exec(resourceShareArn);
    if (!captured || captured.length < 2) {
        throw new Error("Could not parse region from resource share arn.");
    }
    const region = captured[1];
    validateRegion(region);
    return region;
}

function getDTRegion(event) {
    const region = event.ResourceProperties.DTRegion;
    validateRegion(region);
    console.log(`Detective region: ${region}`);
    return region;
}

function validateRegion(region) {
    const regionRegex = /[a-z]+(-[a-z]+)+-\d/;
    if (!regionRegex.test(region)) {
        throw new Error(`Invalid region: ${region}.`);
    }
}


function getAthenaResultBucket(event) {
    const bucketRegex = new RegExp(ATHENA_RESULT_BUCKET_PARAMETER.AllowedPattern);
    const bucketName = event.ResourceProperties.AthenaResultsBucket;
    if (!bucketRegex.test(bucketName)) {
        throw new Error("Invalid bucket name.");
    }
    console.log(`Athena result bucket: ${bucketName}`);
    return bucketName;
}

function getStackId(event) {
    const stackIdRegex = new RegExp(STACK_ID_PARAMETER.AllowedPattern);
    const stackId = event.ResourceProperties.StackId;
    if (!stackIdRegex.test(stackId)) {
        throw new Error("Invalid stackId.");
    }
    console.log(`stackId: ${stackId}`);
    return stackId;
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
    console.log(`database name: ${databaseName}`);
    return databaseName;
}

async function getDatabaseNameArn(ramClient, resourceShareArn) {
    const response = await ramClient.send(new ListResourcesCommand({
        resourceOwner: "OTHER-ACCOUNTS",
        resourceShareArns: [resourceShareArn],
        resourceType: "glue:database"
    }))
    if (response.resources.length == 0) {
        throw new Error("Found no database associated with resource share ARN.")
    }
    return response.resources[0].arn;
}

/**
 * Get list of table names shared in this resource share arn.
 * Throws error if no table is found.
 */
async function getTableNames(ramClient, resourceShareArn) {
    const tableArns = await getTableArns(ramClient, resourceShareArn);
    let tableNames = [];
    for (const tableArn of tableArns) {
        const captured = TABLE_NAME_CAPTURE_REGEX.exec(tableArn);
        if (!captured || captured.length < 2) {
            throw new Error("Could not parse table name from table arn.");
        }
        tableNames.push(captured[1]);
    }
    console.log("Table names: " + JSON.stringify(tableNames));
    return tableNames;
}

async function getTableArns(ramClient, resourceShareArn) {
    const response = await ramClient.send(new ListResourcesCommand({
        resourceOwner: "OTHER-ACCOUNTS",
        resourceShareArns: [resourceShareArn],
        resourceType: "glue:table"
    }))
    if (response.resources.length == 0) {
        throw new Error("Found no table associated with resource share ARN.")
    }
    let arns = [];
    for (const resource of response.resources) {
        arns.push(resource.arn);
    }
    return arns;
}

async function saveParameter(ssmClient, parameter, parameterValue) {
    const input = { // PutParameterRequest
        Name: parameter.Name, // required
        Description: parameter.Description,
        Value: parameterValue,
        Type: parameter.Type,
        AllowedPattern: parameter.AllowedPattern,
        Tier: "Standard",
    };
    console.log(`Saving parameter ${parameter.Name}...`);
    const command = new PutParameterCommand(input);
    try {
        await ssmClient.send(command);
    } catch (error) {
        if (error instanceof ParameterAlreadyExists) {
            const stackId = await getStackIdParameter(ssmClient);
            if (!!stackId) {
                console.error(`SSM Parameter ${parameter.Name} already exists, another stack with stack ID ${stackId} created by this template already exists, please delete it first.`);
            } else {
                console.error(`SSM Parameter ${parameter.Name} already exists, another stack created by this template could already exist, please delete the existing stack before creating a new one.`);
            }
        }
        throw error;
    }
}

/**
 * Get STACK_ID_PARAMETER in SSM. Return undefined if not found or any error.
 */
async function getStackIdParameter(ssmClient) {
    const input = { // GetParameterRequest
        Name: STACK_ID_PARAMETER.Name,
    };
    const command = new GetParameterCommand(input);
    try {
        const response = await ssmClient.send(command);
        return response.Parameter.Value;
    } catch (exception) {
        return undefined;
    }
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
