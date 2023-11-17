export const RESOURCE_SHARE_ARN_PARAMETER = {
    Name: "/Detective/SLI/ResourceShareArn",
    Description: "Security Lake resource share arn",
    Type: "String",
    AllowedPattern: "^arn:aws[-\\w]{0,10}?:ram:.+"
};
export const ATHENA_RESULT_BUCKET_PARAMETER = {
    Name: "/Detective/SLI/S3Bucket",
    Description: "Athena result bucket",
    Type: "String",
    AllowedPattern: "^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$"
};
export const TABLE_NAMES_PARAMETER = {
    Name: "/Detective/SLI/TableNames",
    Description: "List of table names in Security Lake resource share arn",
    Type: "StringList",
    AllowedPattern: ".+"
}
export const DATABASE_NAME_PARAMETER = {
    Name: "/Detective/SLI/DatabaseName",
    Description: "Database name in Security Lake resource share arn",
    Type: "String",
    AllowedPattern: ".+"
};
export const STACK_ID_PARAMETER = {
    Name: "/Detective/SLI/StackId",
    Description: "Stack Id of security lake integration stack",
    Type: "String",
    AllowedPattern: ".+"
};
// ex: arn:aws:glue:us-west-2:123456789012:database/amazon_security_lake_glue_db_us_west_2
export const DATABASE_NAME_CAPTURE_REGEX = /^arn:aws[-\w]{0,10}?:glue:[^:]+:[^:]+:database\/(.+)$/;
// ex: arn:aws:glue:us-west-2:123456789012:table/amazon_security_lake_glue_db_us_west_2/amazon_security_lake_table_us_west_2_cloud_trail_mgmt_1_0
export const TABLE_NAME_CAPTURE_REGEX = /^arn:aws[-\w]{0,10}?:glue:[^:]+:[^:]+:table\/[^\/]+\/(.+)$/;
