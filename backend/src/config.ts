import dotenv from "dotenv";
dotenv.config();

// Only include explicit credentials when they are actually set — otherwise
// let the AWS SDK use its default credential chain (env vars, ~/.aws/credentials,
// IAM role, etc.). Passing empty strings causes cryptic "security key not found" errors.
interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

function awsCredentials(): AwsCredentials | undefined {
  const id = process.env.AWS_ACCESS_KEY_ID;
  const secret = process.env.AWS_SECRET_ACCESS_KEY;
  if (id && secret) return { accessKeyId: id, secretAccessKey: secret };
  return undefined;
}

export const config = {
  port: parseInt(process.env.PORT || "4040", 10),
  nodeEnv: process.env.NODE_ENV || "development",

  admin: {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  },

  jwt: {
    secret: process.env.JWT_SECRET || "dev-secret-change-in-production",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },

  dynamodb: {
    region: process.env.AWS_REGION || "us-east-1",
    credentials: awsCredentials(),
    tableName: process.env.DYNAMODB_TABLE || "InsightFactor",
    endpoint: process.env.DYNAMODB_ENDPOINT || undefined,
  },

  s3: {
    region: process.env.S3_BUCKET_REGION || process.env.AWS_REGION || "us-east-1",
    bucket: process.env.S3_BUCKET || "",
    credentials: awsCredentials(),
  },

  appUrl: process.env.APP_URL || "http://localhost:3000",

  smtp: {
    host: process.env.SMTP_HOST || "",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  },
} as const;
