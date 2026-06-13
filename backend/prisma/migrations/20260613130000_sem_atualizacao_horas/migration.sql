-- Notificação "veículo sem atualização": o tempo (em horas) passa a ser escolha do usuário.
-- Padrão 3h preserva o comportamento anterior.

ALTER TABLE "PreferenciaNotificacao" ADD COLUMN "semAtualizacaoHoras" INTEGER DEFAULT 3;
