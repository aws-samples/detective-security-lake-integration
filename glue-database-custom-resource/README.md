### GlueDatabase CloudFormation Custom Resource Lambda
#### Description
A custom resource provider that takes a RAM resource share arn, extracts shared Glue database from it, and creates corresponding database in this account/region.

#### Dependencies
This lambda needs the following AWS JavaScript v3 SDK:
- "@aws-sdk/client-glue"
- "@aws-sdk/client-ram"
