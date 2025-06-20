const express = require('express');
const http = require('http');
const mariadb = require('mariadb');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const pool = mariadb.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'senha_root',
  database: process.env.DB_NAME || 'chatdb',
  connectionLimit: 5,
  acquireTimeout: 30000,
  connectTimeout: 30000,
  idleTimeout: 60000,
  socketTimeout: 60000
});

const initDatabase = async () => {
  let retries = 5;
  while (retries > 0) {
    try {
      const conn = await pool.getConnection();
      await conn.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user VARCHAR(255) NOT NULL,
          text TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      conn.release();
      console.log('Conexão com o banco de dados estabelecida com sucesso!');
      return;
    } catch (err) {
      console.error(`Tentativa de conexão falhou. Tentativas restantes: ${retries-1}`);
      console.error('Erro:', err.message);
      retries--;
      if (retries === 0) {
        console.error('Não foi possível conectar ao banco de dados após várias tentativas.');
        process.exit(1);
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

initDatabase();

app.use(express.static('public'));
app.use(express.json());

app.get('/api/messages', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const messages = await conn.query({ sql: `
      SELECT id, user, text, timestamp FROM messages 
      ORDER BY timestamp DESC 
      LIMIT 30
    `, bigNumberStrings: true, supportBigNumbers: true });
    res.json(messages.reverse());
  } catch (err) {
    console.error('Erro ao buscar mensagens:', err.message);
    res.status(500).json({ error: 'Erro ao buscar mensagens do banco de dados' });
  } finally {
    if (conn) conn.release();
  }
});

app.delete('/api/messages/:id', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const result = await conn.query('DELETE FROM messages WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'Mensagem não encontrada' });
    } else {
      res.json({ message: 'Mensagem deletada com sucesso' });
    }
  } catch (err) {
    console.error('Erro ao deletar mensagem:', err.message);
    res.status(500).json({ error: 'Erro ao deletar mensagem' });
  } finally {
    if (conn) conn.release();
  }
});

app.put('/api/messages/:id', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const result = await conn.query(
      'UPDATE messages SET text = ? WHERE id = ?',
      [req.body.text, req.params.id]
    );
    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'Mensagem não encontrada' });
    } else {
      res.json({ message: 'Mensagem atualizada com sucesso' });
    }
  } catch (err) {
    console.error('Erro ao atualizar mensagem:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar mensagem' });
  } finally {
    if (conn) conn.release();
  }
});

io.on('connection', (socket) => {
  console.log('Usuário conectado:', socket.id);

  socket.on('chat message', async (msg) => {
    let conn;
    try {
      conn = await pool.getConnection();
      const result = await conn.query(
        'INSERT INTO messages (user, text) VALUES (?, ?)',
        [msg.user, msg.text]
      );
      const newMessage = {
        id: result.insertId.toString(),
        user: msg.user,
        text: msg.text,
        timestamp: new Date()
      };
      io.emit('chat message', newMessage);
    } catch (err) {
      console.error('Erro ao salvar mensagem:', err.message);
    } finally {
      if (conn) conn.release();
    }
  });

  socket.on('disconnect', () => {
    console.log('Usuário desconectado:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});