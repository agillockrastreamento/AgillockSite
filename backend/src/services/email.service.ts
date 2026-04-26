import nodemailer from 'nodemailer';

class EmailService {
  private transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.hostinger.com',
      port: Number(process.env.SMTP_PORT) || 465,
      secure: true, // true para 465, false para outras portas
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async enviarEmail(to: string, subject: string, html: string) {
    try {
      const info = await this.transporter.sendMail({
        from: `"AgilLock Rastreamento" <${process.env.SMTP_USER}>`,
        to,
        subject,
        html,
      });
      console.log('E-mail enviado: %s', info.messageId);
      return info;
    } catch (error) {
      console.error('Erro ao enviar e-mail:', error);
      throw error;
    }
  }

  // Template moderno para alertas
  gerarTemplateAlerta(clienteNome: string, veiculoNome: string, placa: string, alertaTipo: string, dataHora: string, endereco?: string) {
    const publicUrl = process.env.PUBLIC_URL || 'https://agillockrastreamento.com.br';
    const logoUrl = `${publicUrl}/AgillockSite/img/logo_agillock_white_new.png`;
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          .email-container { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f4f7f9; padding: 20px; }
          .card { background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
          .header { background: linear-gradient(135deg, #1a2a6c, #b21f1f, #fdbb2d); background-color: #2980b9; padding: 30px; text-align: center; }
          .header img { height: 50px; margin-bottom: 10px; }
          .content { padding: 40px; color: #444; line-height: 1.6; }
          .welcome { font-size: 18px; font-weight: bold; color: #2c3e50; margin-bottom: 20px; }
          .event-box { background-color: #fdfdfd; border: 1px solid #edf2f7; border-left: 6px solid #e74c3c; border-radius: 8px; padding: 20px; margin: 25px 0; }
          .event-item { margin-bottom: 10px; font-size: 14px; }
          .event-label { font-weight: bold; color: #7f8c8d; text-transform: uppercase; font-size: 11px; display: block; margin-bottom: 2px; }
          .event-value { font-size: 15px; color: #2d3748; }
          .btn { display: inline-block; background-color: #2980b9; color: #ffffff !important; padding: 14px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; margin-top: 20px; transition: background-color 0.3s; }
          .footer { text-align: center; padding: 20px; color: #a0aec0; font-size: 12px; }
          .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; background-color: #fff5f5; color: #e53e3e; font-weight: bold; font-size: 12px; border: 1px solid #feb2b2; }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="card">
            <div class="header">
              <img src="${logoUrl}" alt="AgilLock Logo">
            </div>
            <div class="content">
              <div class="welcome">Olá, ${clienteNome}!</div>
              <p>O sistema AgilLock detectou uma nova ocorrência importante relacionada ao seu veículo monitorado.</p>
              
              <div class="event-box">
                <div class="event-item">
                  <span class="event-label">Tipo de Evento</span>
                  <span class="badge">${alertaTipo}</span>
                </div>
                <div class="event-item">
                  <span class="event-label">Veículo</span>
                  <span class="event-value"><strong>${veiculoNome}</strong> ${placa ? `— ${placa}` : ''}</span>
                </div>
                <div class="event-item">
                  <span class="event-label">Data e Hora</span>
                  <span class="event-value">${dataHora}</span>
                </div>
                ${endereco ? `
                <div class="event-item">
                  <span class="event-label">Localização Aproximada</span>
                  <span class="event-value">${endereco}</span>
                </div>` : ''}
              </div>

              <p>Recomendamos que acesse o portal para verificar o status em tempo real e o histórico completo.</p>
              
              <div style="text-align: center;">
                <a href="${publicUrl}/cliente/login.html" class="btn">ACESSAR MEU PAINEL</a>
              </div>
            </div>
            <div class="footer">
              Este é um aviso automático gerado pelo AgilLock Rastreamento.<br>
              Por questões de segurança, nunca compartilhe sua senha com terceiros.<br><br>
              <strong>© 2026 AgilLock Rastreamento — Segurança em movimento.</strong>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

export default new EmailService();