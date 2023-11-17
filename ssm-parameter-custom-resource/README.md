### SsmParameters CloudFormation Custom Resource Lambda
#### Description
A custom resource provider that takes a RAM resource share arn and some other inputs, list out the Glue database and table names in it and update SSM (Systems Manager) parameters accordingly.

#### Dependencies
This lambda needs the following AWS JavaScript v3 SDK:
- "@aws-sdk/client-ram"
- "@aws-sdk/client-ssm"
