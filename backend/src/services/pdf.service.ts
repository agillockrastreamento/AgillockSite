// backend/src/services/pdf.service.ts
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

export async function htmlParaPdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    
    // Caminho da logo no servidor
    const logoPath = path.resolve(process.cwd(), 'src/templates/logo_agillock_white_new.png');
    let logoBase64 = '';
    try {
      logoBase64 = fs.readFileSync(logoPath).toString('base64');
    } catch (e) {
      console.warn('Logo não encontrada para o cabeçalho do PDF');
    }

    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'A4',
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="width: 100%; font-size: 10px; margin: 0 40px; text-align: right; padding-top: 10px; font-family: Arial, sans-serif;">
          <img src="data:image/png;base64,${logoBase64}" style="height: 35px;">
        </div>`,
      footerTemplate: `
        <div style="width: 100%; font-size: 8px; margin: 0 40px; text-align: center; border-top: 1px solid #ccc; padding-top: 5px; color: #555; font-family: Arial, sans-serif;">
          <p style="margin: 2px 0;"><strong>AGILLOCK GESTÃO DE RISCO</strong></p>
          <p style="margin: 2px 0;">Rua Curitiba, nº 553, bairro Henrique Jorge, CEP: 60.526-035 – Fortaleza/Ceará</p>
          <p style="margin: 2px 0;">https://www.agillock.com.br • agillockrastreamento@gmail.com • + 55 (85) 4101-0103 (whatsapp)/(85) 99970-3738</p>
          <div style="text-align: right; margin-top: 2px;">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>
        </div>`,
      margin: {
        top: '80px',
        bottom: '100px',
        left: '60px',
        right: '60px'
      },
      printBackground: true
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}



