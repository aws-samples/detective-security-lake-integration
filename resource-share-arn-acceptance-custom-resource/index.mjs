'use strict';

import https from "https";
import url from "url";
import {
    ResourceShareInvitationStatus,
    GetResourceShareInvitationsCommand,
    ListResourcesCommand,
    ResourceShareInvitationAlreadyAcceptedException,
    AcceptResourceShareInvitationCommand,
    RAMClient
} from "@aws-sdk/client-ram";

/**
 * Lambda that takes a RAM resource share arn, searches for its corresponding invitation arn and accepts it.
 **/
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
        reason = `Received unknown RequestType ${event.RequestType}.`;
        console.error(reason);
        result = "FAILED";
    }
    await sendResponse(event, context, result, reason);
};

async function startCreate(event, context) {
    try {
        const resourceShareArn = getResourceShareArn(event);
        console.log(`resource share arn: ${resourceShareArn}`);
        const region = getResourceShareRegion(resourceShareArn);
        console.log(`region: ${region}`);
        const ramClient = constructRAMClient(region);
        const [invitationStatus, invitationArn] = await getInvitation(ramClient, resourceShareArn);
        await handleInvitation(ramClient, invitationStatus, invitationArn);
        return ["SUCCESS", undefined];
    } catch (exception) {
        console.log(exception);
        return ["FAILED", exception];
    }
}

async function handleInvitation(ramClient, invitationStatus, invitationArn) {
    console.log(`Invitation status, invitation Arn: (${invitationStatus}, ${invitationArn})`);
    if (invitationStatus === ResourceShareInvitationStatus.PENDING) {
        await acceptInvitation(ramClient, invitationArn, invitationStatus);
    } else if (invitationStatus === ResourceShareInvitationStatus.EXPIRED) {
        throw new Error("Invitation has expired.");
    } else if (invitationStatus === ResourceShareInvitationStatus.ACCEPTED) {
        console.log("Invitation arn has already been accepted.");
    } else if (invitationStatus === ResourceShareInvitationStatus.REJECTED) {
        throw new Error("Invitation has already been rejected.");
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

function getResourceShareRegion(resourceShareArn) {
    const captured = /^arn:aws[-\w]{0,10}?:ram:([^:]+):.+/.exec(resourceShareArn);
    if (!captured || captured.length < 2) {
        throw new Error("Could not parse region from resource share arn.");
    }
    const region = captured[1];
    validateRegion(region);
    return region;
}

function validateRegion(region) {
    const regionRegex = /[a-z]+(-[a-z]+)+-\d/;
    if (!regionRegex.test(region)) {
        throw new Error(`Invalid region: ${region}.` );
    }
}

/**
 * Get resource share invitation status and arn from resourceShareArn.
 */
async function getInvitation(ramClient, resourceShareArn) {
    const invitationsRequest = {
        resourceShareArns: [
            resourceShareArn,
        ],
    };
    const command = new GetResourceShareInvitationsCommand(invitationsRequest);
    const response = await ramClient.send(command);
    if (response.resourceShareInvitations.length > 0 &&
        !!response.resourceShareInvitations[0].resourceShareInvitationArn) {
        return [response.resourceShareInvitations[0].status, response.resourceShareInvitations[0].resourceShareInvitationArn];
    } else {
        console.log("Resource share invitation not found, checking whether it has been accepted..");
        if (await resourceShareAlreadyAccepted(ramClient, resourceShareArn)) {
            return [ResourceShareInvitationStatus.ACCEPTED, undefined];
        }
        throw new Error("Invalid ResourceShareArn: ResourceShareInvitationArn not found.");
    }
}

async function resourceShareAlreadyAccepted(ramClient, resourceShareArn) {
    const input = { // ListResourcesRequest
        resourceOwner: "OTHER-ACCOUNTS",
        resourceShareArns: [
            resourceShareArn
        ]
    };
    const command = new ListResourcesCommand(input);
    const response = await ramClient.send(command);
    if (response.resources.length === 0) {
        console.log("Cannot find resource share arn in existing resources.");
        return false;
    } else {
        return true;
    }
}

function constructRAMClient(region) {
    return new RAMClient({
        region
    });
}

async function acceptInvitation(ramClient, inviteArn) {
    const input = {
        resourceShareInvitationArn: inviteArn,
    };
    console.log("Accepting invitation..");
    const command = new AcceptResourceShareInvitationCommand(input);
    try {
        await ramClient.send(command);
    } catch (error) {
        if (error instanceof ResourceShareInvitationAlreadyAcceptedException) {
            console.log("Invitation arn has already been accepted.");
        } else {
            throw error;
        }
    }
}

// Send response to the pre-signed S3 URL
function sendResponse(event, context, responseStatus, reason) {
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
