// Preenche `Dispositivo.ultimoCartaoMotorista` a partir do histórico recente do
// Traccar. A coluna passa a ser mantida automaticamente a cada posição recebida,
// mas os dispositivos que já estavam em operação só teriam valor no próximo
// login de jornada — até lá o card do veículo mostraria o vínculo antigo em vez
// do motorista real. Este script fecha essa lacuna uma única vez.
//
// Rodar dentro do container: npx -y tsx scripts/backfill-ultimo-cartao.ts
import prisma from '../src/utils/prisma';
import { traccarGetDevices, traccarGetPositionHistory, cartaoDaPosicao } from '../src/services/traccar.service';

const DIAS = 7;

async function main() {
  const dispositivos = await prisma.dispositivo.findMany({
    where: { ativo: true },
    select: { id: true, nome: true, identificador: true },
  });
  const traccarDevices = await traccarGetDevices();
  const traccarIdPorImei = new Map(traccarDevices.map(d => [d.uniqueId, d.id]));

  const ate = new Date();
  const de = new Date(Date.now() - DIAS * 24 * 60 * 60 * 1000);
  let atualizados = 0;

  for (const dispositivo of dispositivos) {
    const traccarId = traccarIdPorImei.get(dispositivo.identificador);
    if (!traccarId) continue;

    const historico = await traccarGetPositionHistory([traccarId], de, ate).catch(() => []);
    let melhor: { t: number; cartao: string; inicio: boolean; lidoEm: Date } | null = null;
    for (const posicao of historico) {
      const leitura = cartaoDaPosicao(posicao.attributes);
      if (!leitura) continue;
      const raw = posicao.deviceTime || posicao.fixTime || posicao.serverTime;
      const lidoEm = raw ? new Date(raw) : null;
      if (!lidoEm || Number.isNaN(lidoEm.getTime())) continue;
      const t = lidoEm.getTime();
      if (!melhor || t > melhor.t) melhor = { t, cartao: leitura.cartao, inicio: leitura.inicio, lidoEm };
    }
    if (!melhor) continue;

    await prisma.dispositivo.update({
      where: { id: dispositivo.id },
      data: {
        // Última leitura foi logout (fim de jornada) → não há motorista ao volante
        ultimoCartaoMotorista: melhor.inicio ? melhor.cartao : null,
        ultimoCartaoMotoristaEm: melhor.lidoEm,
      },
    });
    atualizados += 1;
    console.log(`${dispositivo.nome}: cartão ${melhor.inicio ? melhor.cartao : '(logout)'} em ${melhor.lidoEm.toISOString()}`);
  }

  console.log(`\n${atualizados} de ${dispositivos.length} dispositivos atualizados.`);
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
