const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

// Подключение к SQLite
const db = new sqlite3.Database('panz_shop.db');

// Создание таблицы заказов
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      items TEXT,
      total INTEGER,
      delivery TEXT,
      status TEXT DEFAULT 'created',
      order_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Получение списка городов СДЭК
app.get('/cdek/cities', async (req, res) => {
  try {
    const response = await axios.get('https://api.cdek.ru/v2/location/cities', {
      headers: { 'Content-Type': 'application/json' },
      params: {
        key: process.env.CDEK_API_KEY,
        country_codes: ['RU'],
        size: 100
      }
    });

    res.json(response.data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка получения городов' });
  }
});

// Расчёт доставки
app.post('/cdek/calculate', async (req, res) => {
  const { cityCode, items } = req.body;

  try {
    const response = await axios.post(
      'https://api.cdek.ru/v2/calculator/tarifflist',
      {
        type: 1, // 1 - дверь-дверь, 2 - склад-склад
        from_location: { code: 44 }, // Москва
        to_location: { code: cityCode },
        packages: [
          {
            weight: 1000, // вес в граммах
            length: 30,
            width: 20,
            height: 10
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.CDEK_ACCOUNT_TOKEN}`
        }
      }
    );

    res.json(response.data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка расчёта доставки' });
  }
});

// Создание заказа (с доставкой)
app.post('/create-order', async (req, res) => {
  const { userId, items, total, delivery } = req.body;

  const orderId = Date.now().toString();

  const stmt = db.prepare(`
    INSERT INTO orders (user_id, items, total, delivery, order_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(userId, JSON.stringify(items), total, JSON.stringify(delivery), orderId);
  stmt.finalize();

  res.json({
    orderId,
    paymentUrl: `https://tinkoff.ru/payment/${orderId}`,
    total
  });
});

// Webhook от Tinkoff
app.post('/tinkoff-webhook', (req, res) => {
  const { OrderId, Status } = req.body;

  db.run(`UPDATE orders SET status = ? WHERE order_id = ?`, [Status, OrderId], function (err) {
    if (err) {
      console.error(err);
    } else {
      console.log(`Статус заказа ${OrderId} обновлён: ${Status}`);
    }
  });

  res.status(200).send('OK');
});

app.listen(3001, () => {
  console.log('Сервер запущен на порту 3001');
});