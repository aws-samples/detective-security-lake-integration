# detective-security-lake-integration

Amazon Detective provides a CloudFormation template and the source code for four CloudFormation Custom Resource Lambdas in this repository. These can be used to streamline integration of Detective with Amazon Security Lake.

There is a provided CloudFormation template which creates a CloudFormation stack that deploys four custom resources. The descriptions for these custom resources are included in their respective folders:
* **SsmParameters CloudFormation Custom Resource Lambda** 
* **GlueDatabase CloudFormation Custom Resource Lambda**
* **GlueTables CloudFormation Custom Resource Lambda**
* **ResourceShareAcceptor CloudFormation Custom Resource Lambda**

The `detective-security-lake-integration.template.yml` CloudFormation template sets up the parameters to manage query access for Security Lake subscribers. For more details refer to https://docs.aws.amazon.com/detective/latest/userguide/securitylake-integration.html.
