### ResourceShareAcceptor CloudFormation Custom Resource Lambda
#### Description
A custom resource provider that takes a RAM resource share arn, search for its corresponding invitation arn and accepts it.

#### Dependencies
This lambda needs the following AWS JavaScript v3 SDK:
- "@aws-sdk/client-ram"
