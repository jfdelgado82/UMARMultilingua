const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Configuración del repositorio
const owner = 'jfdelgado82';
const repo = 'UMARMultilingua';
const path = 'chatino.json';
const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
//const token = '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'; // Mantener seguro en backend
//Git Kraken token: eJwtzLFuwjAQgOF3udlD08bBeOtQMQEdqFR1sc72OVgxsXVOoIB4dySU9Ze+/w7oHNV6yAONoKGV0qLEVkmnnH+z0qrmA73vWre2dhVCoxrlVx0IKJzP0RMv9L6czLSs+mM275Pfh8M2xU33hfT3fe6OfZWfu59b/1v3rbrFIEHAi5jpWgg0WEImBgHV5VdAf4qjLrNN0ZmBroIJvc7cC6aSxVyJNZ0wJnHJPISULyCA/ktkqgYn0OOc0uPxBNp7UOQ=
//eJwtzLFuwjAQgOF3udlD08bBeOtQMQEdqFR1sc72OVgxsXVOoIB4dySU9Ze+/w7oHNV6yAONoKGV0qLEVkmnnH+z0qrmA73vWre2dhVCoxrlVx0IKJzP0RMv9L6czLSs+mM275Pfh8M2xU33hfT3fe6OfZWfu59b/1v3rbrFIEHAi5jpWgg0WEImBgHV5VdAf4qjLrNN0ZmBroIJvc7cC6aSxVyJNZ0wJnHJPISULyCA/ktkqgYn0OOc0uPxBNp7UOQ=


// Obtener SHA y contenido del archivo
async function obtenerArchivo() {
    const res = await axios.get(apiUrl, {
        headers: {
            Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json'
        }
    });
    const sha = res.data.sha;
    const content = Buffer.from(res.data.content, 'base64').toString();
    const data = JSON.parse(content);
    return { data, sha };
}

app.get('/', (req, res) => {
    res.json({ mensaje: 'Backend funcionando correctamente 🚀' });
  });

// Endpoint GET: Leer diccionario
app.get('/diccionario', async (req, res) => {
    try {
        const variante = req.query.variante;
        const { data } = await obtenerArchivo();

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
