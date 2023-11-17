### GlueTables CloudFormation Custom Resource Lambda
#### Description
A custom resource provider that takes a RAM resource share arn, extracts shared Glue Database name from it, and grant the following permission to every IAM principal in input `LakeFormationPrincipals`:
- Lake Formation `SELECT` permission on every table under the database

#### Dependencies
This lambda needs the following AWS JavaScript v3 SDK:
- "@aws-sdk/client-glue"
- "@aws-sdk/client-ram"
- "@aws-sdk/client-lakeformation"
