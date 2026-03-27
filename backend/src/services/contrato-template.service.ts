// backend/src/services/contrato-template.service.ts
import fs from 'fs';
import path from 'path';

const TEMPLATES_DIR = path.resolve(process.cwd(), 'src/templates/contratos');
const LOGO_PATH = path.resolve(process.cwd(), 'src/templates/logo_agillock_white_new.png');

export interface DadosContrato {
  tipo: string;
  cliente: {
    nome: string; cpfCnpj?: string; tipoPessoa?: string;
    rg?: string; profissao?: string; estadoCivil?: string; dataNascimento?: string;
    nirc?: string;
    telefone?: string; email?: string;
    logradouro?: string; numero?: string; complemento?: string; bairro?: string; cidade?: string; estado?: string; cep?: string;
    socios?: Array<{
      nome: string; cpf?: string; rg?: string; profissao?: string; estadoCivil?: string; nacionalidade?: string; dataNascimento?: string;
      email?: string; telefone?: string;
      logradouro?: string; numero?: string; complemento?: string; bairro?: string; cidade?: string; estado?: string; cep?: string;
    }>;
  };
  fiadores?: Array<{
    nome: string; cpf?: string; rg?: string; profissao?: string; estadoCivil?: string; nacionalidade?: string; dataNascimento?: string;
    email?: string; telefone?: string; logradouro?: string; numero?: string; complemento?: string; bairro?: string; cidade?: string; estado?: string; cep?: string;
  }>;
  testemunhas: Array<{ nome: string; cpf?: string }>;
  representante: { nome?: string; cpf?: string };
}

function getLogoBase64(): string {
  try {
    const bitmap = fs.readFileSync(LOGO_PATH);
    return Buffer.from(bitmap).toString('base64');
  } catch (e) {
    console.error('Erro ao ler logo para PDF:', e);
    return '';
  }
}

const COMPANY_INFO = {
  NOME: 'AGILLOCK GESTÃO DE RISCO',
  ENDERECO: 'Rua Curitiba, nº 553, bairro Henrique Jorge, CEP: 60.526-035 – Fortaleza/Ceará',
  SITE: 'http://www.agillock.com.br',
  EMAIL: 'agillockrastreamento@gmail.com',
  CONTATOS: '+ 55 (85) 4101-0103 (whatsapp) / (85) 99970-3738'
};

function fmtData(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('T')[0].split('-');
  return `${d}/${m}/${y}`;
}

function fmtEndereco(obj: { logradouro?: string; numero?: string; complemento?: string; bairro?: string; cidade?: string; estado?: string; cep?: string }): string {
  const parts = [obj.logradouro, obj.numero, obj.complemento, obj.bairro, obj.cidade && obj.estado ? `${obj.cidade}/${obj.estado}` : (obj.cidade || obj.estado), obj.cep ? `CEP ${obj.cep}` : ''];
  return parts.filter(Boolean).join(', ');
}

const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

function dataHoje(): { longa: string; curta: string } {
  const d = new Date();
  return {
    longa: `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`,
    curta: `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`,
  };
}

function tipoParaArquivo(tipo: string): string {
  const map: Record<string, string> = {
    PF_COM_ASSISTENCIA: 'pf-com-assistencia.html',
    PF_SEM_ASSISTENCIA: 'pf-sem-assistencia.html',
    PJ_COM_ASSISTENCIA: 'pj-com-assistencia.html',
    PJ_SEM_ASSISTENCIA: 'pj-sem-assistencia.html',
  };
  return map[tipo] || 'pf-com-assistencia.html';
}

export function preencherTemplate(tipo: string, dados: DadosContrato): string {
  const arquivo = path.join(TEMPLATES_DIR, tipoParaArquivo(tipo));
  let html: string;
  try {
    html = fs.readFileSync(arquivo, 'utf-8');
  } catch {
    throw new Error(`Template de contrato não encontrado: ${arquivo}. Verifique se os arquivos de template existem.`);
  }

  const { longa, curta } = dataHoje();
  const c = dados.cliente;
  const rep = dados.representante;
  const socios = c.socios || [];
  const fiadores = dados.fiadores || [];
  const testemunhas = dados.testemunhas;

  // Processar blocos condicionais ANTES da substituição de variáveis
  const conditions: Record<string, boolean> = {
    IF_SOCIO_2:   socios.length >= 2,
    IF_SOCIO_3:   socios.length >= 3,
    IF_SOCIO_4:   socios.length >= 4,
    IF_SOCIO_5:   socios.length >= 5,
    IF_FIADORES:  fiadores.length >= 1,
    IF_FIADOR_2:  fiadores.length >= 2,
    IF_FIADOR_3:  fiadores.length >= 3,
    IF_FIADOR_4:  fiadores.length >= 4,
    IF_FIADOR_5:  fiadores.length >= 5,
  };
  for (const [cond, show] of Object.entries(conditions)) {
    const re = new RegExp(`\\{\\{#${cond}\\}\\}([\\s\\S]*?)\\{\\{\\/${cond}\\}\\}`, 'g');
    html = html.replace(re, show ? '$1' : '');
  }

  const vars: Record<string, string> = {
    DATA_HOJE: longa,
    DATA_HOJE_CURTA: curta,
    // Logo e Empresa
    LOGO_BASE64: getLogoBase64(),
    COMPANY_NOME: COMPANY_INFO.NOME,
    COMPANY_ENDERECO: COMPANY_INFO.ENDERECO,
    COMPANY_SITE: COMPANY_INFO.SITE,
    COMPANY_EMAIL: COMPANY_INFO.EMAIL,
    COMPANY_CONTATOS: COMPANY_INFO.CONTATOS,
    // PF
    NOME_CLIENTE: c.nome || '',
    CPF_CLIENTE: c.cpfCnpj || '',
    RG_CLIENTE: c.rg || '',
    NIRC: c.nirc || '',
    PROFISSAO_CLIENTE: c.profissao || '',
    ESTADO_CIVIL_CLIENTE: c.estadoCivil || '',
    DATA_NASCIMENTO_CLIENTE: fmtData(c.dataNascimento),
    TELEFONE_CLIENTE: c.telefone || '',
    EMAIL_CLIENTE: c.email || '',
    ENDERECO_CLIENTE: fmtEndereco(c),
    // PJ
    SOCIOS_LABEL: socios.length === 1 ? 'seu sócio' : 'seus sócios',
    RAZAO_SOCIAL: c.nome || '',
    CNPJ: c.cpfCnpj || '',
    TELEFONE_PJ: c.telefone || '',
    EMAIL_PJ: c.email || '',
    ENDERECO_PJ: fmtEndereco(c),
    // Representante
    REPRESENTANTE_NOME: rep.nome || '',
    REPRESENTANTE_CPF: rep.cpf || '',
  };

  // Sócios
  socios.forEach((s, i) => {
    const n = i + 1;
    vars[`SOCIO_${n}_NOME`] = s.nome || '';
    vars[`SOCIO_${n}_CPF`] = s.cpf || '';
    vars[`SOCIO_${n}_RG`] = s.rg || '';
    vars[`SOCIO_${n}_PROFISSAO`] = s.profissao || '';
    vars[`SOCIO_${n}_ESTADO_CIVIL`] = s.estadoCivil || '';
    vars[`SOCIO_${n}_NACIONALIDADE`] = s.nacionalidade || '';
    vars[`SOCIO_${n}_DATA_NASCIMENTO`] = fmtData(s.dataNascimento);
    vars[`SOCIO_${n}_ENDERECO`] = fmtEndereco(s);
    vars[`SOCIO_${n}_LOGRADOURO`] = s.logradouro || '';
    vars[`SOCIO_${n}_NUMERO`] = s.numero || '';
    vars[`SOCIO_${n}_COMPLEMENTO`] = s.complemento || '';
    vars[`SOCIO_${n}_BAIRRO`] = s.bairro || '';
    vars[`SOCIO_${n}_CEP`] = s.cep || '';
    vars[`SOCIO_${n}_CIDADE`] = s.cidade || '';
    vars[`SOCIO_${n}_ESTADO`] = s.estado || '';
  });

  // Fiadores
  fiadores.forEach((f, i) => {
    const n = i + 1;
    vars[`FIADOR_${n}_NOME`] = f.nome || '';
    vars[`FIADOR_${n}_CPF`] = f.cpf || '';
    vars[`FIADOR_${n}_RG`] = f.rg || '';
    vars[`FIADOR_${n}_PROFISSAO`] = f.profissao || '';
    vars[`FIADOR_${n}_ESTADO_CIVIL`] = f.estadoCivil || '';
    vars[`FIADOR_${n}_NACIONALIDADE`] = f.nacionalidade || '';
    vars[`FIADOR_${n}_DATA_NASCIMENTO`] = fmtData(f.dataNascimento);
    vars[`FIADOR_${n}_ENDERECO`] = fmtEndereco(f);
  });

  // Testemunhas
  [0, 1].forEach(i => {
    const n = i + 1;
    const t = testemunhas[i];
    vars[`TESTEMUNHA_${n}_NOME`] = t?.nome || '';
    vars[`TESTEMUNHA_${n}_CPF`] = t?.cpf || '';
  });

  // Substituir todos os placeholders
  for (const [key, val] of Object.entries(vars)) {
    html = html.split(`{{${key}}}`).join(val);
  }

  return html;
}
