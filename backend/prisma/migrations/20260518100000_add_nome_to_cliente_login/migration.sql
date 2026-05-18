-- Nome opcional do sub-usuário (vinculado). Para responsável fica null e o
-- portal usa Cliente.nome como antes.
ALTER TABLE "ClienteLogin" ADD COLUMN "nome" TEXT;
