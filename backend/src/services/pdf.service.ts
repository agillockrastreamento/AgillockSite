// backend/src/services/pdf.service.ts
import puppeteer from 'puppeteer';

export async function htmlParaPdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', margin: { top: '2cm', bottom: '2cm', left: '2.5cm', right: '2.5cm' } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
