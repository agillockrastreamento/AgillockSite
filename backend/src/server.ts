import 'dotenv/config';
import http from 'http';
import app from './app';
import { initTraccarWebSocket } from './services/traccar.ws';

const PORT = process.env.PORT || 3000;

const httpServer = http.createServer(app);

initTraccarWebSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
