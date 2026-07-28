-- CreateTable
CREATE TABLE "EventCounter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "EventCounter_name_date_key" ON "EventCounter"("name", "date");
