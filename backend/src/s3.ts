import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./config.js";

const s3Config: ConstructorParameters<typeof S3Client>[0] = {
  region: config.s3.region,
};
if (config.s3.credentials) {
  s3Config.credentials = config.s3.credentials;
}

const s3 = new S3Client(s3Config);

const BUCKET = config.s3.bucket;

export async function uploadFile(
  key: string,
  body: Buffer | Uint8Array | Blob,
  contentType: string
) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  await s3.send(command);
  return { key, url: `https://${BUCKET}.s3.${config.s3.region}.amazonaws.com/${key}` };
}

export async function deleteFile(key: string) {
  const command = new DeleteObjectCommand({ Bucket: BUCKET, Key: key });
  await s3.send(command);
}

export async function getSignedDownloadUrl(key: string, expiresInSeconds = 60) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}
