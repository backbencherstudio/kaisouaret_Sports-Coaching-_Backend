-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "bitrate" INTEGER,
ADD COLUMN     "codec" TEXT,
ADD COLUMN     "duration" INTEGER,
ADD COLUMN     "format" TEXT,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "thumbnail" TEXT,
ADD COLUMN     "width" INTEGER;
