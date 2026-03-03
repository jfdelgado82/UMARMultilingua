// ============================
// UMAR MULTILINGUA BACKEND
// ============================

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
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
  },
  usuarios: {
    0: 'usuarios.json'
  }
};

// ============================
// CACHE
// ============================

const cacheData = {};
const cacheSHA = {};

// ============================
// OBTENER ARCHIVO DESDE GITHUB
// ============================

async function obtenerArchivo(tipo, agrupacion, forzar = false) {

  if (!rutas[tipo]) throw new Error('Tipo no válido');

  const path =
    tipo === 'usuarios'
      ? rutas[tipo][0]
      : rutas[tipo][Number(agrupacion)];

  if (!path) throw new Error('Agrupación no válida');

  const key = `${tipo}_${agrupacion || 0}`;

  if (!forzar && cacheData[key]) {
    return { data: cacheData[key], sha: cacheSHA[key], path };
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json'
    }
  });

  const sha = response.data.sha;
  const raw = await axios.get(response.data.download_url);

  cacheData[key] = raw.data;
  cacheSHA[key] = sha;

  return { data: raw.data, sha, path };
}

// ============================
// LOGIN
// ============================

app.post('/login', async (req, res) => {
  try {

    const { correoElectronico, contraseña } = req.body;

    if (!correoElectronico || !contraseña)
      return res.status(400).json({ error: 'Faltan credenciales' });

    const { data } = await obtenerArchivo('usuarios', 0);

    const usuario = data.find(u =>
      u.correoElectronico === correoElectronico
    );

    if (!usuario)
      return res.status(401).json({ error: 'Usuario no encontrado' });

    const passwordValido = await bcrypt.compare(
      contraseña,
      usuario.contraseña
    );

    if (!passwordValido)
      return res.status(401).json({ error: 'Contraseña incorrecta' });

    const JWT_SECRET = process.env.JWT_SECRET || 'clave_temporal_123';
    console.log("JWT_SECRET:", process.env.JWT_SECRET);
    const token = jwt.sign(
      { correoElectronico: usuario.correoElectronico, rol: usuario.rol },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      mensaje: 'Login exitoso',
      token,
      usuario: {
        nombre: usuario.nombre,
        correoElectronico: usuario.correoElectronico,
        rol: usuario.rol
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================
// REGISTRO DE USUARIOS
// ============================

app.post('/usuarios', async (req, res) => {
  try {

    const { nombre, correoElectronico, contraseña, rol } = req.body;

    const { data, sha, path } = await obtenerArchivo('usuarios', 0, true);

    const existe = data.find(u =>
      u.correoElectronico === correoElectronico
    );

    if (existe)
      return res.status(400).json({ error: 'Usuario ya existe' });

    const hash = await bcrypt.hash(contraseña, 10);

    data.push({
      nombre,
      correoElectronico,
      contraseña: hash,
      rol: rol || 'usuario'
    });

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const body = {
      message: 'Nuevo usuario',
      content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
      sha
    };

    const response = await axios.put(url, body, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json'
      }
    });

    cacheData['usuarios_0'] = data;
    cacheSHA['usuarios_0'] = response.data.content.sha;

    res.json({ mensaje: 'Usuario creado correctamente' });

  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// ============================
// CRUD DICCIONARIO Y CORPUS
// ============================

// CREAR REGISTRO
app.post('/:tipo', async (req, res) => {
  try {

    const { tipo } = req.params;
    const { agrupacion } = req.query;

    const { data, sha, path } = await obtenerArchivo(tipo, agrupacion, true);

    const campoId =
      tipo === 'diccionario' ? 'idPalabra' :
      tipo === 'corpus' ? 'idExpresion' :
      null;

    if (!campoId)
      return res.status(400).json({ error: 'Tipo no válido' });

    const nuevoId = data.length > 0
      ? Math.max(...data.map(d => d[campoId] || 0)) + 1
      : 1;

    const nuevoRegistro = {
      ...req.body,
      [campoId]: nuevoId
    };

    data.push(nuevoRegistro);

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

    cacheData[`${tipo}_${agrupacion}`] = data;
    cacheSHA[`${tipo}_${agrupacion}`] = response.data.content.sha;

    res.json({ mensaje: 'Registro creado correctamente' });

  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// ACTUALIZAR REGISTRO
app.put('/:tipo/:id', async (req, res) => {
  try {

    const { tipo, id } = req.params;
    const { agrupacion } = req.query;

    const { data, sha, path } = await obtenerArchivo(tipo, agrupacion, true);

    const campoId =
      tipo === 'diccionario' ? 'idPalabra' :
      tipo === 'corpus' ? 'idExpresion' :
      null;

    if (!campoId)
      return res.status(400).json({ error: 'Tipo no válido' });

    const index = data.findIndex(item =>
      item[campoId] == id
    );

    if (index === -1)
      return res.status(404).json({ error: 'Registro no encontrado' });

    data[index] = { ...data[index], ...req.body };

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const body = {
      message: `Actualización en ${tipo} ID ${id}`,
      content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
      sha
    };

    const response = await axios.put(url, body, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json'
      }
    });

    cacheData[`${tipo}_${agrupacion}`] = data;
    cacheSHA[`${tipo}_${agrupacion}`] = response.data.content.sha;

    res.json({ mensaje: 'Registro actualizado correctamente' });

  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// ELIMINAR REGISTRO
app.delete('/:tipo/:id', async (req, res) => {
  try {

    const { tipo, id } = req.params;
    const { agrupacion } = req.query;

    const { data, sha, path } = await obtenerArchivo(tipo, agrupacion, true);

    const campoId =
      tipo === 'diccionario' ? 'idPalabra' :
      tipo === 'corpus' ? 'idExpresion' :
      null;

    if (!campoId)
      return res.status(400).json({ error: 'Tipo no válido' });

    const nuevoArray = data.filter(item =>
      item[campoId] != id
    );

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const body = {
      message: `Eliminación en ${tipo}`,
      content: Buffer.from(JSON.stringify(nuevoArray, null, 2)).toString('base64'),
      sha
    };

    const response = await axios.put(url, body, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json'
      }
    });

    cacheData[`${tipo}_${agrupacion}`] = nuevoArray;
    cacheSHA[`${tipo}_${agrupacion}`] = response.data.content.sha;

    res.json({ mensaje: 'Registro eliminado correctamente' });

  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// ============================
// GET
// ============================

// ============================
// GET CON FILTRO POR VARIANTE
// ============================

app.get('/:tipo', async (req, res) => {
  try {

    const { tipo } = req.params;
    const { variante, agrupacion } = req.query;

    if (tipo !== 'usuarios' && !agrupacion) {
      return res.status(400).json({ error: 'Debe enviar agrupacion' });
    }

    const { data } = await obtenerArchivo(tipo, agrupacion || 0);

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
// SERVIDOR
// ============================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
