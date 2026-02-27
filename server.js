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

  let path;

  if (tipo === 'usuarios') {
    path = rutas[tipo][0];
  } else {
    path = rutas[tipo][Number(agrupacion)];
  }

  if (!path) {
    throw new Error('Agrupación no válida');
  }

  const key = `${tipo}_${agrupacion || 0}`;

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

  console.log(`Archivo ${path} cargado`);

  return { data, sha, path };
}

// ============================
// MIDDLEWARE JWT
// ============================

function verificarToken(req, res, next) {

  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  const token = header.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// ============================
// LOGIN
// ============================

app.post('/login', async (req, res) => {
  try {

    const { correoElectronico, contraseña } = req.body;

    if (!correoElectronico || !contraseña) {
      return res.status(400).json({ error: 'Faltan credenciales' });
    }

    const { data } = await obtenerArchivo('usuarios', 0);

    const usuario = data.find(u =>
      u.correoElectronico === correoElectronico
    );

    if (!usuario) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    const passwordValido = await bcrypt.compare(
      contraseña,
      usuario.contraseña
    );

    if (!passwordValido) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    const token = jwt.sign(
      {
        correoElectronico: usuario.correoElectronico,
        rol: usuario.rol
      },
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
    console.error(error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================
// CREAR USUARIO (Admin)
// ============================

app.post('/usuarios', verificarToken, async (req, res) => {
  try {

    const { nombre, correoElectronico, contraseña, rol } = req.body;

    const { data, sha, path } = await obtenerArchivo('usuarios', 0);

    const hash = await bcrypt.hash(contraseña, 10);

    data.push({
      nombre,
      correoElectronico,
      contraseña: hash,
      rol
    });

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const body = {
      message: `Nuevo usuario`,
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
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// ============================
// GET (DICCIONARIO / CORPUS)
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
  console.log("Token GitHub:", process.env.GITHUB_TOKEN ? "Sí" : "No");
  console.log("JWT Secret:", process.env.JWT_SECRET ? "Sí" : "No");
});
