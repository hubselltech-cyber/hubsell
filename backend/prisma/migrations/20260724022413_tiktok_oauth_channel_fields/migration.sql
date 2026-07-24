-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "accessTokenExpireAt" TIMESTAMP(3),
ADD COLUMN     "externalShopName" TEXT,
ADD COLUMN     "refreshToken" TEXT,
ADD COLUMN     "refreshTokenExpireAt" TIMESTAMP(3),
ADD COLUMN     "shopCipher" TEXT;
