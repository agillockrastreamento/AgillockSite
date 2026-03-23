import prisma from '../utils/prisma';

/**
 * Calcula e registra comissões para um boleto recém-pago.
 *
 * Regra: cada placa tem um vendedor "dono" (o primeiro que gerou cobrança para ela).
 * - Boleto individual: 1 comissão para o vendedor dono da placa
 * - Boleto unificado: 1 comissão por placa, cada uma para o vendedor dono daquela placa
 *   (um boleto unificado pode gerar comissões para múltiplos vendedores)
 */
export async function registrarComissoes(boletoId: string): Promise<void> {
  const [boleto, configs] = await Promise.all([
    prisma.boleto.findUnique({
      where: { id: boletoId },
      include: {
        placa: { select: { vendedorId: true } },
        dispositivo: { select: { vendedorId: true } },
        placasUnificadas: {
          include: { placa: { select: { vendedorId: true } } },
        },
        dispositivosUnificados: {
          include: { dispositivo: { select: { vendedorId: true } } },
        },
      },
    }),
    prisma.configuracoes.findUnique({ where: { id: '1' } }),
  ]);

  if (!boleto || !configs) {
    console.log(`[comissao] boletoId=${boletoId} — boleto ou configs não encontrados, abortando.`);
    return;
  }

  const { percentualMenor, percentualMaior, valorReferencia } = configs;
  const refNum = Number(valorReferencia);

  type ComissaoData = {
    vendedorId: string;
    boletoId: string;
    valorReferencia: number;
    percentualAplicado: number;
    valorComissao: number;
  };

  const comissoes: ComissaoData[] = [];

  const totalUnificados = boleto.placasUnificadas.length + boleto.dispositivosUnificados.length;

  if (totalUnificados > 0) {
    // Boleto unificado: comissão por placa/dispositivo, para o vendedor dono de cada um
    console.log(`[comissao] boletoId=${boletoId} tipo=UNIFICADO placas=${boleto.placasUnificadas.length} dispositivos=${boleto.dispositivosUnificados.length}`);
    for (const bp of boleto.placasUnificadas) {
      const vendedorIdPlaca = bp.placa?.vendedorId;
      console.log(`[comissao]   placaId=${bp.placaId} vendedorId=${vendedorIdPlaca ?? 'null'}`);
      if (!vendedorIdPlaca) continue;
      const valorRef = Number(bp.valorPlaca);
      const percentual = valorRef >= refNum ? Number(percentualMaior) : Number(percentualMenor);
      comissoes.push({
        vendedorId: vendedorIdPlaca,
        boletoId,
        valorReferencia: valorRef,
        percentualAplicado: percentual,
        valorComissao: Math.round(valorRef * percentual) / 100,
      });
    }
    for (const bd of boleto.dispositivosUnificados) {
      const vendedorIdDisp = bd.dispositivo?.vendedorId;
      console.log(`[comissao]   dispositivoId=${bd.dispositivoId} vendedorId=${vendedorIdDisp ?? 'null'}`);
      if (!vendedorIdDisp) continue;
      const valorRef = Number(bd.valorDispositivo);
      const percentual = valorRef >= refNum ? Number(percentualMaior) : Number(percentualMenor);
      comissoes.push({
        vendedorId: vendedorIdDisp,
        boletoId,
        valorReferencia: valorRef,
        percentualAplicado: percentual,
        valorComissao: Math.round(valorRef * percentual) / 100,
      });
    }
  } else {
    // Boleto individual: comissão para o vendedor dono da placa ou do dispositivo
    const vendedorIdPlaca = boleto.placa?.vendedorId;
    const vendedorIdDisp  = boleto.dispositivo?.vendedorId;
    const vendedorEfetivo = vendedorIdPlaca || vendedorIdDisp;
    console.log(`[comissao] boletoId=${boletoId} tipo=INDIVIDUAL placaId=${boleto.placaId ?? 'null'} dispositivoId=${boleto.dispositivoId ?? 'null'} vendedorId=${vendedorEfetivo ?? 'null'}`);
    if (!vendedorEfetivo) {
      console.log(`[comissao] sem vendedorId — sem comissão`);
      return;
    }
    const valorRef = Number(boleto.valor);
    const percentual = valorRef >= refNum ? Number(percentualMaior) : Number(percentualMenor);
    comissoes.push({
      vendedorId: vendedorEfetivo,
      boletoId,
      valorReferencia: valorRef,
      percentualAplicado: percentual,
      valorComissao: Math.round(valorRef * percentual) / 100,
    });
  }

  if (comissoes.length > 0) {
    console.log(`[comissao] criando ${comissoes.length} comissão(ões):`, comissoes.map(c => `vendedor=${c.vendedorId} valor=${c.valorComissao}`));
    await prisma.comissaoVendedor.createMany({ data: comissoes });
  } else {
    console.log(`[comissao] nenhuma comissão gerada para boletoId=${boletoId}`);
  }
}
