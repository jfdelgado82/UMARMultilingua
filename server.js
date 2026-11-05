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
app.use(express.json({ limit: '15mb' }));

// ============================
// CONFIGURACIÓN
// ============================

const owner = 'jfdelgado82';
const repo = 'UMARMultilingua';
const branch = process.env.GITHUB_BRANCH || 'main';

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

    const JWT_SECRET = process.env.JWT_SECRET;

    if (!JWT_SECRET) {
      throw new Error('Falta configurar JWT_SECRET en Render');
    }

      const token = jwt.sign(
      {
        correoElectronico: usuario.correoElectronico,
        rol: usuario.rol
      },
      JWT_SECRET,
        { expiresIn: '8h' }
  );

    res.json({
      mensaje: 'Login exitoso',
      token,
      usuario: {
        nombre: usuario.nombre,
        correoElectronico: usuario.correoElectronico,
        rol: usuario.rol,
        activo: usuario.activo
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
      rol: rol || 'usuario',
      activo: false
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
// ACTUALIZAR USUARIO
// ============================

app.put('/usuarios/:correo', async (req, res) => {
  try {

    const { correo } = req.params;
    const { data, sha, path } = await obtenerArchivo('usuarios', 0, true);

    const index = data.findIndex(
      u => u.correoElectronico === correo
    );

    if (index === -1)
      return res.status(404).json({ error: 'Usuario no encontrado' });

    // actualizar datos
    data[index] = {
      ...data[index],
      ...req.body
    };

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const body = {
      message: `Actualización usuario ${correo}`,
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

    res.json({ mensaje: 'Usuario actualizado correctamente' });

  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// ============================
// ELIMINAR USUARIO
// ============================

app.delete('/usuarios/:correo', async (req, res) => {
  try {

    const { correo } = req.params;

    const { data, sha, path } = await obtenerArchivo('usuarios', 0, true);

    const nuevoArray = data.filter(
      u => u.correoElectronico !== correo
    );

    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const body = {
      message: `Eliminar usuario ${correo}`,
      content: Buffer.from(JSON.stringify(nuevoArray, null, 2)).toString('base64'),
      sha
    };

    const response = await axios.put(url, body, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json'
      }
    });

    cacheData['usuarios_0'] = nuevoArray;
    cacheSHA['usuarios_0'] = response.data.content.sha;

    res.json({ mensaje: 'Usuario eliminado correctamente' });

  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});


// ==========================================
// GUARDAR AUDIO DEL DICCIONARIO EN GITHUB
// ==========================================

app.post('/diccionario/:id/audio', async (req, res) => {
  try {

    const { id } = req.params;
    const { variante, agrupacion } = req.query;
    const { audioBase64, mimeType } = req.body;

    // Validaciones
    if (!id || !variante || !agrupacion) {
      return res.status(400).json({
        error: 'Faltan datos del vocablo'
      });
    }

    if (!audioBase64) {
      return res.status(400).json({
        error: 'No se recibió ningún audio'
      });
    }

    if (!process.env.GITHUB_TOKEN) {
      throw new Error('Falta configurar GITHUB_TOKEN');
    }

    // Determinar carpeta lingüística
    const agrupaciones = {
      1: 'zapoteco',
      2: 'chatino'
    };

    const nombreAgrupacion = agrupaciones[Number(agrupacion)];

    if (!nombreAgrupacion) {
      return res.status(400).json({
        error: 'Agrupación no válida'
      });
    }

    // Determinar extensión del archivo
    const extensiones = {
      'audio/webm': 'webm',
      'audio/mp4': 'm4a',
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav'
    };

    const tipoAudio = String(mimeType || 'audio/webm')
      .split(';')[0]
      .toLowerCase();

    const extension = extensiones[tipoAudio];

    if (!extension) {
      return res.status(400).json({
        error: 'Formato de audio no compatible'
      });
    }

    // Limpiar Base64
    const base64Limpio = audioBase64.replace(
      /^data:audio\/[^;]+;base64,/,
      ''
    );

    const buffer = Buffer.from(base64Limpio, 'base64');

    if (!buffer.length) {
      return res.status(400).json({
        error: 'El archivo de audio está vacío'
      });
    }

    // Ruta del audio en GitHub
    const audioPath =
      `audios/${nombreAgrupacion}/${variante}/${id}.${extension}`;

    const githubUrl =
      `https://api.github.com/repos/${owner}/${repo}/contents/${audioPath}`;

    const headers = {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json'
    };

    // Comprobar si ya existe un audio para este vocablo
    let shaAudio = undefined;

    try {
      const existente = await axios.get(githubUrl, { headers });
      shaAudio = existente.data.sha;
    } catch (error) {
      if (error.response?.status !== 404) {
        throw error;
      }
    }

    // Subir audio a GitHub
    await axios.put(githubUrl, {
      message: `Guardar audio del vocablo ${id}`,
      content: buffer.toString('base64'),
      branch,
      ...(shaAudio ? { sha: shaAudio } : {})
    }, { headers });

    // Dirección pública del archivo
    const audioUrl =
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${audioPath}`;

    // Actualizar el JSON del diccionario
    const { data, sha, path } =
      await obtenerArchivo('diccionario', agrupacion, true);

    const index = data.findIndex(item =>
      String(item.idPalabra) === String(id) &&
      String(item.idDiccionario) === String(variante)
    );

    if (index === -1) {
      return res.status(404).json({
        error: 'Audio subido, pero no se encontró el vocablo en el diccionario',
        audioUrl
      });
    }

    data[index].audioUrl = audioUrl;

    const jsonUrl =
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const respuestaJSON = await axios.put(jsonUrl, {
      message: `Actualizar audio del vocablo ${id}`,
      content: Buffer.from(
        JSON.stringify(data, null, 2)
      ).toString('base64'),
      sha,
      branch
    }, { headers });

    // Actualizar caché
    const cacheKey = `diccionario_${agrupacion}`;

    cacheData[cacheKey] = data;
    cacheSHA[cacheKey] = respuestaJSON.data.content.sha;

    res.json({
      mensaje: 'Audio guardado correctamente',
      audioUrl
    });

  } catch (error) {

    console.error(
      'ERROR AL GUARDAR AUDIO:',
      error.response?.data || error.message
    );

    res.status(500).json({
      error: 'No fue posible guardar el audio',
      detalle: error.response?.data || error.message
    });

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
      [campoId]: String(nuevoId)
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
    const { variante, agrupacion } = req.query;

    if (!agrupacion || !variante)
      return res.status(400).json({ error: 'Debe enviar variante y agrupacion' });

    const { data, sha, path } = await obtenerArchivo(tipo, agrupacion, true);

    const campoId =
      tipo === 'diccionario' ? 'idPalabra' :
      tipo === 'corpus' ? 'idExpresion' :
      null;

    if (!campoId)
      return res.status(400).json({ error: 'Tipo no válido' });

    // 🔥 CORREGIDO AQUÍ
    const index = data.findIndex(item =>
      item[campoId] == id &&
      item.idDiccionario == variante
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
    console.error("ERROR REAL:", error.response?.data || error.message);
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
// GET CON FILTRO POR VARIANTE (old)
// ============================

// ============================
// GET CON BÚSQUEDA Y PAGINACIÓN (new)
// ============================

app.get('/:tipo', async (req, res) => {
  try {
    const { tipo } = req.params;
    const {
      variante,
      agrupacion,
      pagina,
      limite,
      q
    } = req.query;

    if (!['diccionario', 'corpus', 'usuarios'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo no válido' });
    }

    if (tipo !== 'usuarios' && !agrupacion) {
      return res.status(400).json({
        error: 'Debe enviar agrupacion'
      });
    }

    const { data } = await obtenerArchivo(tipo, agrupacion || 0);

    let resultado = Array.isArray(data) ? data : [];

    // Filtrar por variante lingüística
    if (variante) {
      const campoFiltro =
        tipo === 'diccionario' ? 'idDiccionario' :
        tipo === 'corpus' ? 'idCorpus' :
        null;

      if (campoFiltro) {
        resultado = resultado.filter(item =>
          String(item[campoFiltro]) === String(variante)
        );
      }
    }

    // Búsqueda en servidor
    const busqueda = String(q || '')
      .trim()
      .toLocaleLowerCase();

    if (busqueda) {
      const normalizar = valor =>
        String(valor || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLocaleLowerCase();

      resultado = resultado.filter(item => {
        const campos = tipo === 'diccionario'
          ? [
              item.nombrePalabra,
              item.traduccion,
              item.lexema,
              item.gramema,
              item.categoriaGramatical
            ]
          : Object.values(item);

        return campos.some(valor =>
          normalizar(valor).includes(normalizar(busqueda))
        );
      });
    }

    // Mantener compatibilidad con consultas anteriores:
    // sin parámetros de paginación se devuelve un arreglo.
    const solicitaPaginacion =
      pagina !== undefined ||
      limite !== undefined ||
      q !== undefined;

    if (!solicitaPaginacion) {
      return res.json(resultado);
    }

    const paginaActual = Math.max(1, parseInt(pagina, 10) || 1);
    const limiteSolicitado = parseInt(limite, 10) || 100;
    const limiteRegistros = Math.min(
      100,
      Math.max(1, limiteSolicitado)
    );

    const total = resultado.length;
    const inicio = (paginaActual - 1) * limiteRegistros;
    const datos = resultado.slice(
      inicio,
      inicio + limiteRegistros
    );

    return res.json({
      datos,
      pagina: paginaActual,
      limite: limiteRegistros,
      total,
      hayMas: inicio + datos.length < total
    });

  } catch (error) {
    console.error('Error al consultar registros:', error);
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
