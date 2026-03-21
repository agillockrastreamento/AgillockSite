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
        placasUnificadas: {
          include: { placa: { select: { vendedorId: true } } },
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

  if (boleto.placasUnificadas.length > 0) {
    // Boleto unificado: comissão por placa, para o vendedor dono de cada placa
    console.log(`[comissao] boletoId=${boletoId} tipo=UNIFICADO placas=${boleto.placasUnificadas.length}`);
    for (const bp of boleto.placasUnificadas) {
      const vendedorIdPlaca = bp.placa?.vendedorId;
      console.log(`[comissao]   placaId=${bp.placaId} vendedorId=${vendedorIdPlaca ?? 'null'}`);
      if (!vendedorIdPlaca) continue; // placa sem vendedor: sem comissão
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
  } else {
    // Boleto individual: comissão para o vendedor dono da placa
    const vendedorIdPlaca = boleto.placa?.vendedorId;
    console.log(`[comissao] boletoId=${boletoId} tipo=INDIVIDUAL placaId=${boleto.placaId ?? 'null'} vendedorId=${vendedorIdPlaca ?? 'null'}`);
    if (!vendedorIdPlaca) {
      console.log(`[comissao] placa sem vendedorId — sem comissão`);
      return;
    }
    const valorRef = Number(boleto.valor);
    const percentual = valorRef >= refNum ? Number(percentualMaior) : Number(percentualMenor);
    comissoes.push({
      vendedorId: vendedorIdPlaca,
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
