'use strict';

import https from "https";
import url from "url";
import {
    ListResourcesCommand,
    RAMClient
} from "@aws-sdk/client-ram";
import {
    GlueClient, 
    AlreadyExistsException, 
    CreateDatabaseCommand
} from "@aws-sdk/client-glue";

/**
 * Lambda that takes a RAM resource share arn, extracts shared Glue database from it, and creates corresponding database in this account/region.
 **/
export async function handler(event, context) {
    console.log("REQUEST RECEIVED.");
    if (event.RequestType === "Update") {
        const reason = "RequestType is Update which is not supported.";
        console.error(reason);
        await sendResponse(event, context, "FAILED", undefined, reason);
        return;
    }

    let result;
    let reason;
    let physicalResourceId;
    if (event.RequestType === "Create") {
        [result, physicalResourceId, reason] = await startCreate(event, context);
    } else if (event.RequestType === "Delete") {
        // For Delete requests, immediately send a SUCCESS response.
        physicalResourceId = event.PhysicalResourceId;
        result = "SUCCESS";
    } else {
        reason = "Unrecognized cloudformation request type received. This custom resource only supports creation and deletion.";
        console.error(reason);
        result = "FAILED";
    }
    await sendResponse(event, context, result, physicalResourceId, reason);
};

async function startCreate(event, context) {
    const region = process.env.AWS_REGION
    try {
        const ramClient = new RAMClient({
            region: region
        })
        const glueClient = new GlueClient({
            region: region
        })

        const resourceShareArn = getResourceShareArn(event);
        console.log('Extracted resource share arn from event: %s', resourceShareArn)

        const sharedGlueDatabaseArn = await getSharedGlueDatabaseArn(ramClient, resourceShareArn);
        console.log('Retrieved shared database name from RAM: %s', sharedGlueDatabaseArn)

        let [securityLakeAdminAccount, databaseName] = getDatabaseArnParts(sharedGlueDatabaseArn)

        await createGlueDatabase(glueClient, securityLakeAdminAccount, databaseName)

        return ["SUCCESS", databaseName, undefined];
    } catch (exception) {
        console.log(exception);
        return ["FAILED", undefined, exception];
    }
}

function getResourceShareArn(event) {
    const resourceShareArn = event.ResourceProperties.ResourceShareArn;
    validateResourceShareArn(resourceShareArn);
    return resourceShareArn;
}

function validateResourceShareArn(arn) {
    const resourceShareRegex = /^arn:aws[-\w]{0,10}?:ram:.+/;
    if(!resourceShareRegex.test(arn)) {
        throw new Error("Invalid ResourceShareArn.");
    }
}

async function getSharedGlueDatabaseArn(ramClient, resourceShareArn) {
    const response = await ramClient.send(new ListResourcesCommand({
        resourceOwner: "OTHER-ACCOUNTS",
        resourceShareArns: [resourceShareArn],
        resourceType: "glue:database"
    }))

    if (response.resources.length == 0) {
        throw new Error("Found no resources associated with resource share ARN.")
    }

    return response.resources[0].arn
}

function getDatabaseArnParts(glueDatabaseArn) {
    const glueDatabaseRegex = /^arn:aws[-\w]{0,10}?:glue:.+:database\/.+/;
    if(!glueDatabaseRegex.test(glueDatabaseArn)) {
        throw new Error(`Glue database discovered via RAM does not match expected ARN format: ${glueDatabaseArn}.`);
    }

    const arnParts = glueDatabaseArn.split(':');
    const securityLakeAdminAccount = arnParts[4]
    const databaseName = arnParts[5].split('/')[1]

    return [securityLakeAdminAccount, databaseName]
}

async function createGlueDatabase(glueClient, securityLakeAdminAccount, databaseName) {
    try {
        await glueClient.send(new CreateDatabaseCommand({
            DatabaseInput: {
                Name: databaseName,
                TargetDatabase: {
                    CatalogId: securityLakeAdminAccount,
                    DatabaseName: databaseName
                }
            }
        }))
        console.log('Successfully created database')
    } catch (e) {
        if (e instanceof AlreadyExistsException) {
            console.log('Database already exists')
            return;
        }

        throw e;
    }
}

// Send response to the pre-signed S3 URL
function sendResponse(event, context, responseStatus, physicalResourceId, reason) {
    return new Promise((resolve, reject) => {
        const responseBody = JSON.stringify({
            Status: responseStatus,
            Reason: composeReason(context, reason),
            PhysicalResourceId: physicalResourceId ?? context.logStreamName,
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
            console.log("sendResponse Error:" + error);
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
