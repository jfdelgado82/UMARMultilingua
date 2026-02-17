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
const token = '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'; // Mantener seguro en backend
const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

// Obtener SHA y contenido del archivo
async function obtenerArchivo() {
    const res = await axios.get(apiUrl, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json'
        }
    });
    const sha = res.data.sha;
    const content = Buffer.from(res.data.content, 'base64').toString();
    const data = JSON.parse(content);
    return { data, sha };
}

// Endpoint GET: Leer diccionario
app.get('/diccionario', async (req, res) => {
    const variante = req.query.variante;
    const { data } = await obtenerArchivo();
    const filtrado = variante
        ? data.filter(item => item.idDiccionario === variante)
        : data;
    res.json(filtrado);
    //console.log('variante2:'+variante);
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
                Authorization: `Bearer ${token}`,
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
                Authorization: `Bearer ${token}`,
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
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json'
            }
        });
        res.json(resp.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, () => console.log('Servidor corriendo...'));
