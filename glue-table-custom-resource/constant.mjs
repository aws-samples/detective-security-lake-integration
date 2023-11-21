// ex: arn:aws:ram:us-east-2:123456789012:resource-share/1a621be9-7c74-4607-af80-5fe0275af5a0
export const RESOURCE_SHARE_ARN_REGEX = "^arn:aws[-\\w]{0,10}?:ram:.+";
// ex: arn:aws:glue:us-west-2:123456789012:database/amazon_security_lake_glue_db_us_west_2
export const DATABASE_NAME_CAPTURE_REGEX = /^arn:aws[-\w]{0,10}?:glue:[^:]+:[^:]+:database\/(.+)$/;
// ex: "arn:aws:cloudformation:us-west-2:123456789012:stack/stack-name/guid"
export const ACCOUNT_ID_FROM_STACK_REGEX = /^arn:aws[-\w]{0,10}?:cloudformation:[^:]+:(\d{12}):(.+)$/;
