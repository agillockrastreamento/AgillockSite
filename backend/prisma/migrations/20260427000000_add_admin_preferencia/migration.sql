CREATE TABLE "AdminPreferencia" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "prefs"     JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminPreferencia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminPreferencia_userId_key" ON "AdminPreferencia"("userId");

ALTER TABLE "AdminPreferencia" ADD CONSTRAINT "AdminPreferencia_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
