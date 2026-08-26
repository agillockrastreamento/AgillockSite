-- Pontuação de CNH (CONSULTA_PONTUACAO): job sem veículo, usa cpf + numeroFormulario.
ALTER TABLE "ConsultaJob" ADD COLUMN "cpf" TEXT;
ALTER TABLE "ConsultaJob" ADD COLUMN "numeroFormulario" TEXT;
