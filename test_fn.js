const handler = require('./api/ranking.js');

async function testVercelFunction() {
  console.log('Testing api/ranking.js GET...');
  let resData = null;
  const mockResGet = {
    setHeader: () => {},
    status: (code) => {
      return {
        json: (data) => {
          resData = data;
          console.log('GET response code:', code, 'ranking items:', data.ranking.length);
        }
      };
    }
  };
  await handler({ method: 'GET' }, mockResGet);

  console.log('Testing api/ranking.js POST...');
  const newScore = {
    id: 'test_vercel_' + Date.now(),
    nombre: 'VercelUser',
    puntos: 3500,
    nivel: 4,
    tasa: 85,
    duracion: 25,
    fecha: new Date().toISOString()
  };
  const mockResPost = {
    setHeader: () => {},
    status: (code) => {
      return {
        json: (data) => {
          console.log('POST response code:', code, 'ok:', data.ok, 'new count:', data.count);
        }
      };
    }
  };
  await handler({ method: 'POST', body: newScore }, mockResPost);
  console.log('api/ranking.js passed test successfully!');
}

testVercelFunction();
