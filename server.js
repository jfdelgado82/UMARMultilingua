const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use((req, res, next) => {
  console.log("🔥 REQUEST:", req.method, req.url);
  next();
});

// Configuración del repositorio
const owner = 'jfdelgado82';
const repo = 'UMARMultilingua';
const rutas = {
  diccionario: {
    1: 'zapoteco.json',
    2: 'chatino.json'
  },
  corpus: {
    1: 'corpus_zapoteco.json',
    2: 'corpus_chatino.json'
  }
};
/*const rutas = {
    1: 'zapoteco.json',
    2: 'chatino.json'
};*/

let cacheDiccionarios = {};
let cacheSHA = {};
//const token = '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'; // Mantener seguro en backend
//Git Kraken token: eJwtzLFuwjAQgOF3udlD08bBeOtQMQEdqFR1sc72OVgxsXVOoIB4dySU9Ze+/w7oHNV6yAONoKGV0qLEVkmnnH+z0qrmA73vWre2dhVCoxrlVx0IKJzP0RMv9L6czLSs+mM275Pfh8M2xU33hfT3fe6OfZWfu59b/1v3rbrFIEHAi5jpWgg0WEImBgHV5VdAf4qjLrNN0ZmBroIJvc7cC6aSxVyJNZ0wJnHJPISULyCA/ktkqgYn0OOc0uPxBNp7UOQ=
//eJwtzLFuwjAQgOF3udlD08bBeOtQMQEdqFR1sc72OVgxsXVOoIB4dySU9Ze+/w7oHNV6yAONoKGV0qLEVkmnnH+z0qrmA73vWre2dhVCoxrlVx0IKJzP0RMv9L6czLSs+mM275Pfh8M2xU33hfT3fe6OfZWfu59b/1v3rbrFIEHAi5jpWgg0WEImBgHV5VdAf4qjLrNN0ZmBroIJvc7cC6aSxVyJNZ0wJnHJPISULyCA/ktkqgYn0OOc0uPxBNp7UOQ=

async function obtenerArchivo(tipo, agrupacion, forzar = false) {

    if (!rutas[tipo]) {
        throw new Error('Tipo no válido: ' + tipo);
    }

    const path = rutas[tipo][Number(agrupacion)];

    if (!path) {
        throw new Error('Agrupación no válida para ' + tipo);
    }

    if (!forzar && cacheDiccionarios[`${tipo}_${agrupacion}`]) {
        return {
            data: cacheDiccionarios[`${tipo}_${agrupacion}`],
            sha: cacheSHA[`${tipo}_${agrupacion}`]
        };
    }

    const metaUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const meta = await axios.get(metaUrl, {
        headers: {
            Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json'
        }
    });

    const sha = meta.data.sha;
    const downloadUrl = meta.data.download_url;

    const raw = await axios.get(downloadUrl);
    const data = raw.data;

    cacheDiccionarios[`${tipo}_${agrupacion}`] = data;
    cacheSHA[`${tipo}_${agrupacion}`] = sha;

    console.log(`Archivo ${path} cargado (${data.length} registros)`);

    return { data, sha };
}
/*async function obtenerArchivo(agrupacion, forzar = false) {

    const path = rutas[Number(agrupacion)];
    if (!path) {
        throw new Error('Agrupación no válida: ' + agrupacion);
    }

    // Si está en cache y no es forzado
    if (!forzar && cacheDiccionarios[agrupacion]) {
        return {
            data: cacheDiccionarios[agrupacion],
            sha: cacheSHA[agrupacion]
        };
    }

    // 1️⃣ Obtener metadata para el SHA
    const metaUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const meta = await axios.get(metaUrl, {
        headers: {
            Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json'
        }
    });

    const sha = meta.data.sha;
    const downloadUrl = meta.data.download_url;

    // 2️⃣ Descargar archivo completo desde RAW
    const raw = await axios.get(downloadUrl);

    const data = raw.data;

    // Guardar en cache
    cacheDiccionarios[agrupacion] = data;
    cacheSHA[agrupacion] = sha;

    console.log(`Archivo ${path} cargado correctamente (${data.length} registros)`);

    return { data, sha };
}*/

app.get('/:tipo', async (req, res) => {
    try {
        const { tipo } = req.params;
        const { variante, agrupacion } = req.query;

        const { data } = await obtenerArchivo(tipo, agrupacion);

        const filtrado = variante
            ? data.filter(item => item.idDiccionario === variante)
            : data;

        res.json(filtrado);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/*app.get('/', (req, res) => {
    res.json({ mensaje: 'Backend funcionando correctamente 🚀' });
  });

// Endpoint GET: Leer diccionario
app.get('/diccionario', async (req, res) => {
    try {
        const variante = req.query.variante;
        const agrupacion = req.query.agrupacion;
        const { data } = await obtenerArchivo(agrupacion);

        const filtrado = variante
            ? data.filter(item => item.idDiccionario === variante)
            : data;

        res.json(filtrado);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});*/

// Endpoint POST: Agregar registro
app.post('/:tipo', async (req, res) => {
    try {
        const { tipo } = req.params;
        const { agrupacion } = req.query;
        const nuevoRegistro = req.body;

        const { data, sha } = await obtenerArchivo(tipo, agrupacion);

        data.push(nuevoRegistro);

        const path = rutas[tipo][Number(agrupacion)];
        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

        const cuerpo = {
            message: `Agregado a ${tipo}`,
            content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
            sha
        };

        const resp = await axios.put(url, cuerpo, {
            headers: {
                Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
                Accept: 'application/vnd.github+json'
            }
        });

        cacheDiccionarios[`${tipo}_${agrupacion}`] = data;
        cacheSHA[`${tipo}_${agrupacion}`] = resp.data.content.sha;

        res.json(resp.data);

    } catch (err) {
        res.status(500).json({ error: err.response?.data || err.message });
    }
});
/*app.post('/diccionario', async (req, res) => {
    try {
        const nuevoRegistro = req.body;
        const { agrupacion } = req.query;

        const path = rutas[Number(agrupacion)];
        if (!path) {
            return res.status(400).json({ error: 'Agrupación inválida' });
        }

        const { data, sha } = await obtenerArchivo(agrupacion);

        data.push(nuevoRegistro);

        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

        const cuerpo = {
            message: 'Agregado desde backend',
            content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
            sha
        };

        const resp = await axios.put(url, cuerpo, {
            headers: {
                Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
                Accept: 'application/vnd.github+json'
            }
        });

        // 🔥 actualizar cache después de escribir
        cacheDiccionarios[agrupacion] = data;
        cacheSHA[agrupacion] = resp.data.content.sha;

        res.json(resp.data);

    } catch (err) {
        console.error("ERROR COMPLETO:", err.response?.data || err.message);
        res.status(500).json({ error: err.response?.data || err.message });
    }
});*/

// Endpoint PUT: Actualizar registro
app.put('/diccionario/:idPalabra', async (req, res) => {
    try {
        const idPalabra = req.params.idPalabra;
        const updates = req.body;
        const { agrupacion } = req.query;

        const path = rutas[Number(agrupacion)];
        if (!path) return res.status(400).json({ error: 'Agrupación inválida' });

        const { data, sha } = await obtenerArchivo(agrupacion);

        const index = data.findIndex(item => item.idPalabra === idPalabra);
        if (index === -1) return res.status(404).json({ error: 'No encontrado' });

        data[index] = { ...data[index], ...updates };

        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

        const cuerpo = {
            message: 'Actualización desde backend',
            content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
            sha
        };

        const resp = await axios.put(url, cuerpo, {
            headers: {
                Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
                Accept: 'application/vnd.github+json'
            }
        });

        // 🔥 actualizar cache
        cacheDiccionarios[agrupacion] = data;
        cacheSHA[agrupacion] = resp.data.content.sha;

        res.json(resp.data);
    } catch (err) {
        console.error("ERROR COMPLETO:", err.response?.data || err.message);
        res.status(500).json({ error: err.response?.data || err.message });
    }
});

// Endpoint DELETE: Borrar registro
app.delete('/diccionario/:idPalabra', async (req, res) => {
    try {
        const idPalabra = req.params.idPalabra;
        const { agrupacion } = req.query;

        const path = rutas[Number(agrupacion)];
        if (!path) return res.status(400).json({ error: 'Agrupación inválida' });

        const { data, sha } = await obtenerArchivo(agrupacion);

        const nuevoData = data.filter(item => item.idPalabra !== idPalabra);

        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

        const cuerpo = {
            message: 'Eliminación desde backend',
            content: Buffer.from(JSON.stringify(nuevoData, null, 2)).toString('base64'),
            sha
        };

        const resp = await axios.put(url, cuerpo, {
            headers: {
                Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
                Accept: 'application/vnd.github+json'
            }
        });

        // 🔥 actualizar cache
        cacheDiccionarios[agrupacion] = nuevoData;
        cacheSHA[agrupacion] = resp.data.content.sha;

        res.json(resp.data);
    } catch (err) {
        console.error("ERROR COMPLETO:", err.response?.data || err.message);
        res.status(500).json({ error: err.response?.data || err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Servidor corriendo...' + PORT));



/*const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Configuración del repositorio
const owner = 'jfdelgado82';
const repo = 'UMARMultilingua';
const rutas = {
    1: 'zapoteco.json', 
    2: 'chatino.json'
};

//const token = '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'; // Mantener seguro en backend
//Git Kraken token: eJwtzLFuwjAQgOF3udlD08bBeOtQMQEdqFR1sc72OVgxsXVOoIB4dySU9Ze+/w7oHNV6yAONoKGV0qLEVkmnnH+z0qrmA73vWre2dhVCoxrlVx0IKJzP0RMv9L6czLSs+mM275Pfh8M2xU33hfT3fe6OfZWfu59b/1v3rbrFIEHAi5jpWgg0WEImBgHV5VdAf4qjLrNN0ZmBroIJvc7cC6aSxVyJNZ0wJnHJPISULyCA/ktkqgYn0OOc0uPxBNp7UOQ=
//eJwtzLFuwjAQgOF3udlD08bBeOtQMQEdqFR1sc72OVgxsXVOoIB4dySU9Ze+/w7oHNV6yAONoKGV0qLEVkmnnH+z0qrmA73vWre2dhVCoxrlVx0IKJzP0RMv9L6czLSs+mM275Pfh8M2xU33hfT3fe6OfZWfu59b/1v3rbrFIEHAi5jpWgg0WEImBgHV5VdAf4qjLrNN0ZmBroIJvc7cC6aSxVyJNZ0wJnHJPISULyCA/ktkqgYn0OOc0uPxBNp7UOQ=


// Obtener SHA y contenido del archivo
async function obtenerArchivo(agrupacion) {

    const path = rutas[Number(agrupacion)];
    if (!path) {
        throw new Error('Variante no válida: ' + numero);
    }
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    console.log(apiUrl);
    console.log("TOKEN:", process.env.GITHUB_TOKEN);
    const res = await axios.get(apiUrl, {
        headers: {
            Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json'
        }
    });
    const sha = res.data.sha;
    const content = Buffer.from(res.data.content, 'base64').toString();
    const data = JSON.parse(content);
    console.log("Tamaño del content:", content.length);
    console.log("Primeros 200 caracteres:", content.substring(0,200));
    return { data, sha };
}

app.get('/', (req, res) => {
    res.json({ mensaje: 'Backend funcionando correctamente 🚀' });
  });

// Endpoint GET: Leer diccionario
app.get('/diccionario', async (req, res) => {
    try {
        const variante = req.query.variante;
        const agrupacion = req.query.agrupacion;
        const { data } = await obtenerArchivo(agrupacion);

        const filtrado = variante
            ? data.filter(item => item.idDiccionario === variante)
            : data;

        res.json(filtrado);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint POST: Agregar registro
app.post('/diccionario', async (req, res) => {
    try {
        const nuevoRegistro = req.body;
        const { data, sha } = await obtenerArchivo();
        data.push(nuevoRegistro);

        const cuerpo = {
            message: 'Agregado desde backend',
            content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
            sha
        };

        const resp = await axios.put(apiUrl, cuerpo, {
            headers: {
                Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
                Accept: 'application/vnd.github+json'
            }
        });
        res.json(resp.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint PUT: Actualizar registro
app.put('/diccionario/:idPalabra', async (req, res) => {
    try {
        const idPalabra = req.params.idPalabra;
        const updates = req.body;
        const { data, sha } = await obtenerArchivo();
        const index = data.findIndex(item => item.idPalabra === idPalabra);
        if (index === -1) return res.status(404).json({ error: 'No encontrado' });
        data[index] = { ...data[index], ...updates };

        const cuerpo = {
            message: 'Actualización desde backend',
            content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
            sha
        };
        const resp = await axios.put(apiUrl, cuerpo, {
            headers: {
                Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
                Accept: 'application/vnd.github+json'
            }
        });
        res.json(resp.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint DELETE: Borrar registro
app.delete('/diccionario/:idPalabra', async (req, res) => {
    try {
        const idPalabra = req.params.idPalabra;
        const { data, sha } = await obtenerArchivo();
        const nuevoData = data.filter(item => item.idPalabra !== idPalabra);

        const cuerpo = {
            message: 'Eliminación desde backend',
            content: Buffer.from(JSON.stringify(nuevoData, null, 2)).toString('base64'),
            sha
        };
        const resp = await axios.put(apiUrl, cuerpo, {
            headers: {
                Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
                Accept: 'application/vnd.github+json'
            }
        });
        res.json(resp.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Servidor corriendo...' + PORT +'-'+ process.env.GITHUB_TOKEN));
*/
