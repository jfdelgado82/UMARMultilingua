// ============================
// UMAR MULTILINGUA BACKEND
// ============================

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ============================
// CONFIGURACIÓN
// ============================

const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;
const SECRET = process.env.JWT_SECRET || "umar_secret";

// ============================
// RUTAS DE ARCHIVOS
// ============================

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
    default: 'usuarios.json'
  }
};

// ============================
// CACHE EN MEMORIA
// ============================

const cacheData = {};
const cacheSHA = {};

// ============================
// FUNCIÓN PARA OBTENER ARCHIVO
// ============================

async function obtenerArchivo(tipo, agrupacion, forzar = false) {

  if (!rutas[tipo]) {
    throw new Error('Tipo no válido');
  }

  let path;

  if (tipo === 'usuarios') {
    path = rutas.usuarios.default;
  } else {
    if (!agrupacion) {
      throw new Error('Debe enviar agrupacion');
    }
    path = rutas[tipo][Number(agrupacion)];
  }

  if (!path) {
    throw new Error('Ruta no válida');
  }

  const key = `${tipo}_${agrupacion || 'default'}`;

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

  return { data, sha, path };
}

// ============================
// GUARDAR CAMBIOS EN GITHUB
// ============================

async function guardarArchivo(path, data, sha) {

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  const contenido = Buffer.from(
    JSON.stringify(data, null, 2)
  ).toString('base64');

  await axios.put(url, {
    message: 'Actualización automática desde backend',
    content: contenido,
    sha
  }, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json'
    }
  });
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
    const decoded = jwt.verify(token, SECRET);
    req.usuario = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// ============================
// LOGIN
// ============================

app.post('/login', async (req, res) => {

  const { correoElectronico, contraseña } = req.body;

  const { data } = await obtenerArchivo('usuarios', null);

  const usuario = data.find(
    u => u.correoElectronico === correoElectronico
  );

  if (!usuario) {
    return res.status(401).json({ error: 'Usuario no encontrado' });
  }

  const valido = await bcrypt.compare(
    contraseña,
    usuario.contraseña
  );

  if (!valido) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }

  const token = jwt.sign(
    { id: usuario.idUsuario, rol: usuario.rol },
    SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    token,
    usuario: {
      idUsuario: usuario.idUsuario,
      nombre: usuario.nombre,
      rol: usuario.rol
    }
  });
});

// ============================
// CRUD GENÉRICO
// ============================

// GET
app.get('/:tipo', async (req, res) => {

  try {

    const { tipo } = req.params;
    const { variante, agrupacion } = req.query;

    const { data } = await obtenerArchivo(tipo, agrupacion);

    if (tipo === 'usuarios') {
      const sinPassword = data.map(u => ({
        idUsuario: u.idUsuario,
        nombre: u.nombre,
        correoElectronico: u.correoElectronico,
        rol: u.rol
      }));
      return res.json(sinPassword);
    }

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
    res.status(500).json({ error: error.message });
  }
});

// POST
app.post('/:tipo', async (req, res) => {

  try {

    const { tipo } = req.params;
    const { agrupacion } = req.query;
    const nuevo = req.body;

    const { data, sha, path } =
      await obtenerArchivo(
        tipo,
        tipo === 'usuarios' ? null : agrupacion
      );

    if (tipo === 'usuarios') {

      const existe = data.find(
        u => u.correoElectronico === nuevo.correoElectronico
      );

      if (existe) {
        return res.status(400).json({ error: 'Correo ya registrado' });
      }

      nuevo.idUsuario = data.length
        ? Math.max(...data.map(u => u.idUsuario)) + 1
        : 1;

      nuevo.contraseña = await bcrypt.hash(nuevo.contraseña, 10);
    }

    data.push(nuevo);

    await guardarArchivo(path, data, sha);

    res.json({ mensaje: 'Registro agregado correctamente' });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT
app.put('/:tipo/:id', verificarToken, async (req, res) => {

  try {

    const { tipo, id } = req.params;
    const { agrupacion } = req.query;
    const cambios = req.body;

    const { data, sha, path } =
      await obtenerArchivo(
        tipo,
        tipo === 'usuarios' ? null : agrupacion,
        true
      );

    const campoId =
      tipo === 'diccionario'
        ? 'idDiccionario'
        : tipo === 'corpus'
          ? 'idCorpus'
          : 'idUsuario';

    const index = data.findIndex(
      item => item[campoId] == id
    );

    if (index === -1) {
      return res.status(404).json({ error: 'No encontrado' });
    }

    data[index] = { ...data[index], ...cambios };

    await guardarArchivo(path, data, sha);

    res.json({ mensaje: 'Registro actualizado' });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE
app.delete('/:tipo/:id', verificarToken, async (req, res) => {

  try {

    const { tipo, id } = req.params;
    const { agrupacion } = req.query;

    const { data, sha, path } =
      await obtenerArchivo(
        tipo,
        tipo === 'usuarios' ? null : agrupacion,
        true
      );

    const campoId =
      tipo === 'diccionario'
        ? 'idDiccionario'
        : tipo === 'corpus'
          ? 'idCorpus'
          : 'idUsuario';

    const nuevaData = data.filter(
      item => item[campoId] != id
    );

    await guardarArchivo(path, nuevaData, sha);

    res.json({ mensaje: 'Registro eliminado' });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================
// INICIAR SERVIDOR
// ============================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
