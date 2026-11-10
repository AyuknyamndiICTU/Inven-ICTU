-- Admissions lists (Fall 2026) carry no date of birth, but do carry gender, nationality, section and a personal email.
ALTER TABLE "students" ALTER COLUMN "dateOfBirth" DROP NOT NULL;
ALTER TABLE "students" ADD COLUMN "personalEmail" TEXT;
ALTER TABLE "students" ADD COLUMN "gender" TEXT;
ALTER TABLE "students" ADD COLUMN "nationality" TEXT;
ALTER TABLE "students" ADD COLUMN "section" TEXT;

-- Where the borrowed equipment is used (Chumbow hall, IT hall, …).
ALTER TABLE "loans" ADD COLUMN "location" TEXT;
CREATE INDEX "loans_location_idx" ON "loans"("location");