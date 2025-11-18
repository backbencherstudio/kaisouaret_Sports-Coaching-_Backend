-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
