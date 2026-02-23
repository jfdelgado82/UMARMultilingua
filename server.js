// ============================
// UMAR MULTILINGUA BACKEND
// ============================

const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ============================
// CONFIGURACIÓN
// ============================

const owner = 'jfdelgado82';
const repo = 'UMARMultilingua';

const rutas = {
  diccionario: {
    1: 'zapoteco.json',
    2: 'chatino.json'
  },
  corpus: {
    1: 'CorpusZapoteco.json',
    2: 'CorpusChatino.json'
  }
};

// ============================
// CACHE EN MEMORIA
// ============================

const cacheData = {};
const cacheSHA = {};

// ============================
// FUNCIÓN CENTRAL PARA OBTENER ARCHIVO
// ============================

async function obtenerArchivo(tipo, agrupacion, forzar = false) {

  if (!rutas[tipo]) {
    throw new Error('Tipo no válido');
  }

  const path = rutas[tipo][Number(agrupacion)];

  if (!path) {
    throw new Error('Agrupación no válida');
  }

  const key = `${tipo}_${agrupacion}`;

  if (!forzar && cacheData[key]) {
    return {
      data: cacheData[key],
      sha: cacheSHA[key],
      path
    };
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json'
    }
  });

  const sha = response.data.sha;
  const downloadUrl = response.data.download_url;

  const raw = await axios.get(downloadUrl);
  const data = raw.data;

  cacheData[key] = data;
  cacheSHA[key] = sha;

  console.log(`Archivo ${path} cargado (${data.length} registros)`);

  return { data, sha, path };
}

// ============================
// GET (DICCIONARIO / CORPUS)
// ============================

app.get('/:tipo', async (req, res) => {
  try {

    const { tipo } = req.params;
    const { variante, agrupacion } = req.query;

    if (!agrupacion) {
      return res.status(400).json({ error: 'Debe enviar agrupacion' });
    }
    const { data } = await obtenerArchivo(tipo, agrupacion);
    let resultado = data;

    if (variante) {
      const campoFiltro =
        tipo === 'diccionario'
          ? 'idDiccionario'
          : tipo === 'corpus'
            ? 'idCorpus'
            : null;

      if (campoFiltro) {
        resultado = data.filter(item =>
          item[campoFiltro] == variante
        );
      }
    }
    res.json(resultado);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================
// POST
// ============================

app.post('/:tipo', async (req, res) => {
  try {

    const { tipo } = req.params;
    const { agrupacion } = req.query;

    if (!agrupacion) {
      return res.status(400).json({ error: 'Debe enviar agrupacion' });
    }

    const nuevo = req.body;

    const { data, sha, path } = await obtenerArchivo(tipo, agrupacion);

    data.push(nuevo);

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const body = {
      message: `Nuevo registro en ${tipo}`,
      content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
      sha
    };

    const response = await axios.put(url, body, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json'
      }
    });

    const key = `${tipo}_${agrupacion}`;
    cacheData[key] = data;
    cacheSHA[key] = response.data.content.sha;

    res.json(response.data);

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// ============================
// PUT
// ============================

app.put('/:tipo/:id', async (req, res) => {

  try {

    const { tipo, id } = req.params;
    const { agrupacion } = req.query;

    if (!agrupacion) {
      return res.status(400).json({ error: 'Debe enviar agrupacion' });
    }

    const actualizado = req.body;
    const { data, sha, path } = await obtenerArchivo(tipo, agrupacion);
    const campoId = tipo === 'corpus' ? 'idExpresion' : 'idPalabra';
    const index = data.findIndex(d => d[campoId] == id);

    if (index === -1) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }

    data[index] = actualizado;

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const body = {
      message: `Actualización en ${tipo}`,
      content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
      sha
    };

    const response = await axios.put(url, body, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json'
      }
    });

    const key = `${tipo}_${agrupacion}`;
    cacheData[key] = data;
    cacheSHA[key] = response.data.content.sha;

    res.json(response.data);

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// ============================
// DELETE
// ============================

app.delete('/:tipo/:id', async (req, res) => {

  try {

    const { tipo, id } = req.params;
    const { agrupacion } = req.query;

    if (!agrupacion) {
      return res.status(400).json({ error: 'Debe enviar agrupacion' });
    }

    const { data, sha, path } = await obtenerArchivo(tipo, agrupacion);

    const nuevosDatos = data.filter(d => d.idPalabra !== id);

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const body = {
      message: `Eliminación en ${tipo}`,
      content: Buffer.from(JSON.stringify(nuevosDatos, null, 2)).toString('base64'),
      sha
    };

    const response = await axios.put(url, body, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json'
      }
    });

    const key = `${tipo}_${agrupacion}`;
    cacheData[key] = nuevosDatos;
    cacheSHA[key] = response.data.content.sha;

    res.json(response.data);

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// ============================
// SERVIDOR
// ============================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
  console.log("Token cargado:", process.env.GITHUB_TOKEN ? "Sí" : "No");
});
