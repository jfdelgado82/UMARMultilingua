// ============================
// UMAR MULTILINGUA BACKEND
// ============================

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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
// UTILIDADES GITHUB
// ============================

function githubHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function githubContentsUrl(path) {
  const encodedPath = path
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');

  return `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;
}

function githubBlobUrl(sha) {
  return `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`;
}

// ============================
// OBTENER CONTENIDO BASE64
// ============================

async function obtenerContenidoGitHub(response, path) {

  let contenidoBase64 = response.data.content;

  // La Contents API puede omitir content cuando el archivo
  // supera el límite de tamaño que permite devolver directamente.

  if (!contenidoBase64) {

    const sha = response.data.sha;

    if (!sha) {
      throw new Error(
        `GitHub no devolvió el SHA necesario para leer ${path}`
      );
    }

    console.log(
      'CONTENIDO NO DISPONIBLE EN CONTENTS API. CONSULTANDO GIT BLOBS:',
      { path, sha }
    );

    const blobResponse = await axios.get(
      githubBlobUrl(sha),
      {
        headers: githubHeaders()
      }
    );

    if (
      !blobResponse.data.content ||
      blobResponse.data.encoding !== 'base64'
    ) {
      throw new Error(
        `GitHub no devolvió contenido Base64 para ${path}`
      );
    }

    contenidoBase64 = blobResponse.data.content;
  }

  const contenido = Buffer.from(
    contenidoBase64.replace(/\s/g, ''),
    'base64'
  ).toString('utf8');

  try {
    return JSON.parse(contenido);
  } catch (error) {
    throw new Error(
      `No se pudo interpretar el JSON ${path}: ${error.message}`
    );
  }
}

// ============================
// OBTENER ARCHIVO DESDE GITHUB
// ============================

async function obtenerArchivo(tipo, agrupacion, forzar = false) {

  if (!rutas[tipo]) {
    throw new Error('Tipo no válido');
  }

  const path =
    tipo === 'usuarios'
      ? rutas[tipo][0]
      : rutas[tipo][Number(agrupacion)];

  if (!path) {
    throw new Error('Agrupación no válida');
  }

  const key = `${tipo}_${agrupacion || 0}`;

  if (!forzar && cacheData[key] && cacheSHA[key]) {
    return {
      data: cacheData[key],
      sha: cacheSHA[key],
      path
    };
  }

  if (!process.env.GITHUB_TOKEN) {
    throw new Error('Falta configurar GITHUB_TOKEN');
  }

  const url = githubContentsUrl(path);

  // Obtener SHA y contenido desde la misma versión del archivo.
  const response = await axios.get(url, {
    headers: {
      ...githubHeaders(),
      'Cache-Control': 'no-cache'
    },
    params: {
      ref: branch
    }
  });

  const sha = response.data.sha;

  if (!sha) {
    throw new Error(
      `GitHub no devolvió el SHA del archivo ${path}`
    );
  }

  const contenido = await obtenerContenidoGitHub(
    response,
    path
  );

  if (
    (
      tipo === 'diccionario' ||
      tipo === 'corpus' ||
      tipo === 'usuarios'
    ) &&
    !Array.isArray(contenido)
  ) {
    throw new Error(
      `El archivo ${path} no contiene un arreglo JSON válido`
    );
  }

  cacheData[key] = contenido;
  cacheSHA[key] = sha;

  console.log('ARCHIVO OBTENIDO DESDE GITHUB:', {
    tipo,
    agrupacion,
    path,
    sha,
    registros: Array.isArray(contenido)
      ? contenido.length
      : undefined
  });

  return {
    data: contenido,
    sha,
    path
  };
}

// ============================
// GUARDAR JSON EN GITHUB
// ============================

async function guardarArchivoGitHub(path, data, sha, mensaje) {

  if (!sha) {
    throw new Error(
      `No se recibió SHA para actualizar ${path}`
    );
  }

  if (!process.env.GITHUB_TOKEN) {
    throw new Error('Falta configurar GITHUB_TOKEN');
  }

  const url = githubContentsUrl(path);

  console.log('ACTUALIZANDO ARCHIVO EN GITHUB:', {
    path,
    sha,
    branch,
    registros: Array.isArray(data) ? data.length : undefined
  });

  const response = await axios.put(
    url,
    {
      message: mensaje,
      content: Buffer.from(
        JSON.stringify(data, null, 2),
        'utf8'
      ).toString('base64'),
      sha,
      branch
    },
    {
      headers: githubHeaders()
    }
  );

  if (!response.data.content?.sha) {
    throw new Error(
      `GitHub no confirmó la actualización de ${path}`
    );
  }

  console.log('ARCHIVO ACTUALIZADO EN GITHUB:', {
    path,
    nuevoSHA: response.data.content.sha,
    commit: response.data.commit?.sha
  });

  return response.data;
}

// ============================
// CONVERTIR Y VALIDAR BASE64
// ============================

function convertirBase64Audio(valor) {

  if (!valor || typeof valor !== 'string') {
    throw new Error(
      'No se recibió información Base64 del audio'
    );
  }

  let base64 = valor.trim();

  if (/^data:/i.test(base64)) {

    const separador = base64.indexOf(',');

    if (separador === -1) {
      throw new Error(
        'El formato Data URL del audio es incorrecto'
      );
    }

    const encabezado = base64.substring(0, separador);

    if (!/;base64$/i.test(encabezado)) {
      throw new Error(
        'La Data URL no contiene información Base64'
      );
    }

    base64 = base64.substring(separador + 1);
  }

  base64 = base64.replace(/\s/g, '');

  base64 = base64
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new Error(
      'La información Base64 contiene caracteres no válidos'
    );
  }

  const sinPadding = base64.replace(/=+$/, '');

  if (sinPadding.length === 0) {
    throw new Error(
      'La información Base64 está vacía'
    );
  }

  if (sinPadding.length % 4 === 1) {
    throw new Error(
      'La longitud de la información Base64 es incorrecta'
    );
  }

  const paddingOriginal =
    base64.length - sinPadding.length;

  if (
    paddingOriginal > 0 &&
    base64.length % 4 !== 0
  ) {
    throw new Error(
      'El padding de la información Base64 es incorrecto'
    );
  }

  const base64Completo = sinPadding.padEnd(
    sinPadding.length +
      ((4 - sinPadding.length % 4) % 4),
    '='
  );

  const buffer = Buffer.from(
    base64Completo,
    'base64'
  );

  if (!buffer.length) {
    throw new Error('El audio recibido está vacío');
  }

  const base64Canonico = buffer
    .toString('base64')
    .replace(/=+$/, '');

  if (base64Canonico !== sinPadding) {
    throw new Error(
      'La información Base64 no pudo decodificarse correctamente'
    );
  }

  return buffer;
}

// ============================
// VALIDAR FIRMA DEL AUDIO
// ============================

function validarFirmaAudio(buffer, extension) {

  const firmasValidas = {

    webm:
      buffer.length >= 4 &&
      buffer.subarray(0, 4).equals(
        Buffer.from([0x1A, 0x45, 0xDF, 0xA3])
      ),

    m4a:
      buffer.length >= 8 &&
      buffer.toString('ascii', 4, 8) === 'ftyp',

    ogg:
      buffer.length >= 4 &&
      buffer.toString('ascii', 0, 4) === 'OggS',

    mp3:
      buffer.length >= 3 &&
      (
        buffer.toString('ascii', 0, 3) === 'ID3' ||
        (
          buffer[0] === 0xFF &&
          (buffer[1] & 0xE0) === 0xE0
        )
      ),

    wav:
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WAVE'
  };

  return Boolean(firmasValidas[extension]);
}

// ============================
// RECUPERAR AUDIOS EXISTENTES
// ============================

async function recuperarAudiosExistentes(agrupacion) {

  const agrupaciones = {
    1: 'zapoteco',
    2: 'chatino'
  };

  const nombreAgrupacion =
    agrupaciones[Number(agrupacion)];

  if (!nombreAgrupacion) {
    throw new Error('Agrupación no válida');
  }

  if (!process.env.GITHUB_TOKEN) {
    throw new Error('Falta configurar GITHUB_TOKEN');
  }

  const { data, sha, path } =
    await obtenerArchivo('diccionario', agrupacion, true);

  if (!Array.isArray(data)) {
    throw new Error(
      'El archivo del diccionario no contiene un arreglo válido'
    );
  }

  const headers = githubHeaders();

  const prioridadExtensiones = [
    'webm',
    'm4a',
    'ogg',
    'mp3',
    'wav'
  ];

  const variantes = [
    ...new Set(
      data
        .map(item =>
          String(item.idDiccionario || '').trim()
        )
        .filter(Boolean)
    )
  ];

  const archivosPorVariante = {};

  for (const variante of variantes) {

    const carpeta =
      `audios/${nombreAgrupacion}/${variante}`;

    const githubUrl = githubContentsUrl(carpeta);

    try {

      const respuesta = await axios.get(githubUrl, {
        headers,
        params: {
          ref: branch
        }
      });

      const archivos = respuesta.data;

      archivosPorVariante[variante] = {};

      if (!Array.isArray(archivos)) {
        continue;
      }

      for (const archivo of archivos) {

        if (archivo.type !== 'file') {
          continue;
        }

        const coincidencia = archivo.name.match(
          /^(\d+)\.(webm|m4a|ogg|mp3|wav)$/i
        );

        if (!coincidencia) {
          continue;
        }

        const idPalabra = coincidencia[1];
        const extension = coincidencia[2].toLowerCase();

        const extensionActual =
          archivosPorVariante[variante][idPalabra];

        if (!extensionActual) {

          archivosPorVariante[variante][idPalabra] =
            extension;

        } else {

          const prioridadNueva =
            prioridadExtensiones.indexOf(extension);

          const prioridadActual =
            prioridadExtensiones.indexOf(extensionActual);

          if (prioridadNueva < prioridadActual) {
            archivosPorVariante[variante][idPalabra] =
              extension;
          }
        }
      }

    } catch (error) {

      if (error.response?.status === 404) {

        console.log(
          'Carpeta de audios no encontrada:',
          carpeta
        );

        archivosPorVariante[variante] = {};
        continue;
      }

      throw error;
    }
  }

  let recuperados = 0;
  let yaRegistrados = 0;
  let noEncontrados = 0;

  for (const item of data) {

    const idPalabra = String(item.idPalabra);
    const variante = String(item.idDiccionario);

    const extension =
      archivosPorVariante[variante]?.[idPalabra];

    if (!extension) {

      if (
        typeof item.audioUrl === 'string' &&
        item.audioUrl.trim() !== ''
      ) {
        yaRegistrados++;
      } else {
        noEncontrados++;
      }

      continue;
    }

    const audioUrl =
      `https://umarmultilingua.onrender.com/diccionario/${encodeURIComponent(idPalabra)}/audio` +
      `?variante=${encodeURIComponent(variante)}` +
      `&agrupacion=${encodeURIComponent(agrupacion)}` +
      `&formato=${encodeURIComponent(extension)}`;

    if (item.audioUrl === audioUrl) {
      yaRegistrados++;
      continue;
    }

    item.audioUrl = audioUrl;
    recuperados++;
  }

  if (recuperados > 0) {

    const respuestaJSON = await guardarArchivoGitHub(
      path,
      data,
      sha,
      `Recuperar direcciones de audios de ${nombreAgrupacion}`
    );

    const cacheKey = `diccionario_${agrupacion}`;

    cacheData[cacheKey] = data;
    cacheSHA[cacheKey] = respuestaJSON.content.sha;
  }

  const resultado = {
    agrupacion: nombreAgrupacion,
    variantesRevisadas: variantes.length,
    registrosRevisados: data.length,
    recuperados,
    yaRegistrados,
    noEncontrados
  };

  console.log(
    '========== RECUPERACIÓN DE AUDIOS =========='
  );
  console.log(resultado);

  return resultado;
}

// ============================
// RUTA PROTEGIDA PARA RECUPERAR AUDIOS
// ============================

app.post('/recuperar-audios/:agrupacion', async (req, res) => {

  try {

    const claveConfigurada =
      process.env.AUDIO_RECOVERY_SECRET;

    const claveRecibida =
      req.headers['x-recovery-secret'];

    if (!claveConfigurada) {
      return res.status(500).json({
        error: 'Falta configurar AUDIO_RECOVERY_SECRET en Render'
      });
    }

    if (
      typeof claveRecibida !== 'string' ||
      Buffer.byteLength(claveRecibida) !==
        Buffer.byteLength(claveConfigurada) ||
      !crypto.timingSafeEqual(
        Buffer.from(claveRecibida),
        Buffer.from(claveConfigurada)
      )
    ) {
      return res.status(401).json({
        error: 'No autorizado'
      });
    }

    const agrupacion = Number(req.params.agrupacion);

    if (![1, 2].includes(agrupacion)) {
      return res.status(400).json({
        error:
          'La agrupación debe ser 1 (Zapoteco) o 2 (Chatino)'
      });
    }

    const resultado =
      await recuperarAudiosExistentes(agrupacion);

    return res.json({
      mensaje: 'Proceso de recuperación terminado',
      resultado
    });

  } catch (error) {

    console.error(
      'ERROR AL RECUPERAR AUDIOS:',
      error.response?.data || error.message
    );

    return res.status(500).json({
      error: 'No fue posible recuperar los audios',
      detalle:
        error.response?.data || error.message
    });
  }
});

// ============================
// LOGIN
// ============================

app.post('/login', async (req, res) => {

  try {

    const {
      correoElectronico,
      contraseña
    } = req.body;

    if (!correoElectronico || !contraseña) {
      return res.status(400).json({
        error: 'Faltan credenciales'
      });
    }

    const { data } =
      await obtenerArchivo('usuarios', 0);

    const usuario = data.find(u =>
      u.correoElectronico === correoElectronico
    );

    if (!usuario) {
      return res.status(401).json({
        error: 'Usuario no encontrado'
      });
    }

    const passwordValido = await bcrypt.compare(
      contraseña,
      usuario.contraseña
    );

    if (!passwordValido) {
      return res.status(401).json({
        error: 'Contraseña incorrecta'
      });
    }

    const JWT_SECRET = process.env.JWT_SECRET;

    if (!JWT_SECRET) {
      throw new Error(
        'Falta configurar JWT_SECRET en Render'
      );
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

    console.error('ERROR LOGIN:', error.message);

    res.status(500).json({
      error: error.message
    });
  }
});

// ============================
// REGISTRO DE USUARIOS
// ============================

app.post('/usuarios', async (req, res) => {

  try {

    const {
      nombre,
      correoElectronico,
      contraseña,
      rol
    } = req.body;

    if (!nombre || !correoElectronico || !contraseña) {
      return res.status(400).json({
        error: 'Faltan datos para registrar al usuario'
      });
    }

    const { data, sha, path } =
      await obtenerArchivo('usuarios', 0, true);

    const existe = data.find(u =>
      u.correoElectronico === correoElectronico
    );

    if (existe) {
      return res.status(400).json({
        error: 'Usuario ya existe'
      });
    }

    const hash = await bcrypt.hash(contraseña, 10);

    data.push({
      nombre,
      correoElectronico,
      contraseña: hash,
      rol: rol || 'usuario',
      activo: false
    });

    const response = await guardarArchivoGitHub(
      path,
      data,
      sha,
      'Nuevo usuario'
    );

    cacheData['usuarios_0'] = data;
    cacheSHA['usuarios_0'] = response.content.sha;

    res.json({
      mensaje: 'Usuario creado correctamente'
    });

  } catch (error) {

    console.error(
      'ERROR REGISTRO:',
      error.response?.data || error.message
    );

    res.status(500).json({
      error: error.response?.data || error.message
    });
  }
});

// ============================
// ACTUALIZAR USUARIO
// ============================

app.put('/usuarios/:correo', async (req, res) => {

  try {

    const { correo } = req.params;

    const { data, sha, path } =
      await obtenerArchivo('usuarios', 0, true);

    const index = data.findIndex(
      u => u.correoElectronico === correo
    );

    if (index === -1) {
      return res.status(404).json({
        error: 'Usuario no encontrado'
      });
    }

    data[index] = {
      ...data[index],
      ...req.body
    };

    const response = await guardarArchivoGitHub(
      path,
      data,
      sha,
      `Actualización usuario ${correo}`
    );

    cacheData['usuarios_0'] = data;
    cacheSHA['usuarios_0'] = response.content.sha;

    res.json({
      mensaje: 'Usuario actualizado correctamente'
    });

  } catch (error) {

    console.error(
      'ERROR ACTUALIZAR USUARIO:',
      error.response?.data || error.message
    );

    res.status(500).json({
      error: error.response?.data || error.message
    });
  }
});

// ============================
// ELIMINAR USUARIO
// ============================

app.delete('/usuarios/:correo', async (req, res) => {

  try {

    const { correo } = req.params;

    const { data, sha, path } =
      await obtenerArchivo('usuarios', 0, true);

    const nuevoArray = data.filter(
      u => u.correoElectronico !== correo
    );

    const response = await guardarArchivoGitHub(
      path,
      nuevoArray,
      sha,
      `Eliminar usuario ${correo}`
    );

    cacheData['usuarios_0'] = nuevoArray;
    cacheSHA['usuarios_0'] = response.content.sha;

    res.json({
      mensaje: 'Usuario eliminado correctamente'
    });

  } catch (error) {

    console.error(
      'ERROR ELIMINAR USUARIO:',
      error.response?.data || error.message
    );

    res.status(500).json({
      error: error.response?.data || error.message
    });
  }
});

// ==========================================
// GUARDAR AUDIO DEL DICCIONARIO EN GITHUB
// ==========================================

app.post('/diccionario/:id/audio', async (req, res) => {

  let etapa = 'inicio';

  try {

    const { id } = req.params;
    const { variante, agrupacion } = req.query;
    const { audioBase64, mimeType } = req.body;

    if (!id || !variante || !agrupacion || !audioBase64) {
      return res.status(400).json({
        error: 'Faltan datos del audio o del vocablo'
      });
    }

    if (!process.env.GITHUB_TOKEN) {
      throw new Error('Falta configurar GITHUB_TOKEN');
    }

    const agrupaciones = {
      1: 'zapoteco',
      2: 'chatino'
    };

    const nombreAgrupacion =
      agrupaciones[Number(agrupacion)];

    if (!nombreAgrupacion) {
      return res.status(400).json({
        error: 'Agrupación no válida'
      });
    }

    const extensiones = {
      'audio/webm': 'webm',
      'audio/mp4': 'm4a',
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav'
    };

    const tipoAudio = String(mimeType || 'audio/webm')
      .split(';')[0]
      .trim()
      .toLowerCase();

    const extension = extensiones[tipoAudio];

    if (!extension) {
      return res.status(400).json({
        error: 'Formato de audio no compatible',
        mimeType
      });
    }

    let buffer;

    try {

      buffer = convertirBase64Audio(audioBase64);

    } catch (errorBase64) {

      console.error('ERROR VALIDANDO BASE64:', {
        mensaje: errorBase64.message,
        tipoDato: typeof audioBase64,
        longitud: typeof audioBase64 === 'string'
          ? audioBase64.length
          : null
      });

      return res.status(400).json({
        error: errorBase64.message
      });
    }

    console.log(
      '========== VALIDACIÓN DE AUDIO =========='
    );

    console.log('Vocablo:', id);
    console.log('Variante:', variante);
    console.log('Agrupación:', agrupacion);
    console.log('MIME:', tipoAudio);
    console.log('Tamaño:', buffer.length, 'bytes');

    if (buffer.length < 256) {
      return res.status(400).json({
        error: 'El audio recibido está vacío o incompleto',
        bytesRecibidos: buffer.length
      });
    }

    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(413).json({
        error: 'El audio supera el límite de 10 MB'
      });
    }

    if (!validarFirmaAudio(buffer, extension)) {
      return res.status(400).json({
        error: 'El contenido no corresponde al formato declarado',
        formato: tipoAudio,
        primerosBytes: buffer.subarray(0, 12).toString('hex')
      });
    }

    // 1. Obtener el JSON actual de GitHub.

    etapa = 'lectura del JSON del diccionario';

    const { data, sha, path } =
      await obtenerArchivo('diccionario', agrupacion, true);

    if (!Array.isArray(data)) {
      throw new Error(
        'El JSON del diccionario no es un arreglo'
      );
    }

    // 2. Encontrar el registro correspondiente.

    etapa = 'búsqueda del vocablo';

    const index = data.findIndex(item =>
      String(item.idPalabra) === String(id) &&
      String(item.idDiccionario) === String(variante)
    );

    if (index === -1) {
      return res.status(404).json({
        error: 'No se encontró el vocablo en el diccionario',
        idPalabra: id,
        idDiccionario: variante,
        agrupacion,
        archivo: path
      });
    }

    console.log('VOCABLO ENCONTRADO:', {
      idPalabra: data[index].idPalabra,
      idDiccionario: data[index].idDiccionario,
      audioUrlAnterior: data[index].audioUrl
    });

    // 3. Crear la ruta del archivo de audio.

    etapa = 'preparación de la ruta del audio';

    const audioPath =
      `audios/${nombreAgrupacion}/${variante}/${id}.${extension}`;

    const audioApiUrl = githubContentsUrl(audioPath);

    // 4. Verificar si el audio ya existe.

    etapa = 'consulta del audio existente';

    let shaAudio;

    try {

      const existente = await axios.get(audioApiUrl, {
        headers: githubHeaders(),
        params: {
          ref: branch
        }
      });

      shaAudio = existente.data.sha;

    } catch (error) {

      if (error.response?.status !== 404) {
        throw error;
      }
    }

    // 5. Subir o reemplazar el audio en GitHub.

    etapa = 'subida del archivo de audio a GitHub';

    const respuestaAudio = await axios.put(
      audioApiUrl,
      {
        message: `Guardar audio del vocablo ${id}`,
        content: buffer.toString('base64'),
        branch,
        ...(shaAudio ? { sha: shaAudio } : {})
      },
      {
        headers: githubHeaders()
      }
    );

    if (!respuestaAudio.data.content?.sha) {
      throw new Error(
        'GitHub no confirmó el almacenamiento del audio'
      );
    }

    console.log('AUDIO SUBIDO CORRECTAMENTE:', {
      ruta: audioPath,
      sha: respuestaAudio.data.content.sha
    });

    // 6. Construir la URL que utilizará Ionic.

    const audioUrl =
      `https://umarmultilingua.onrender.com/diccionario/${encodeURIComponent(id)}/audio` +
      `?variante=${encodeURIComponent(variante)}` +
      `&agrupacion=${encodeURIComponent(agrupacion)}` +
      `&formato=${encodeURIComponent(extension)}`;

    // 7. Asignar la URL al registro.

    etapa = 'asignación de audioUrl';

    data[index].audioUrl = audioUrl;

    console.log('URL ASIGNADA:', {
      idPalabra: data[index].idPalabra,
      idDiccionario: data[index].idDiccionario,
      audioUrl: data[index].audioUrl
    });

    // 8. Guardar el JSON actualizado en GitHub.

    etapa = 'actualización del JSON en GitHub';

    const respuestaJSON = await guardarArchivoGitHub(
      path,
      data,
      sha,
      `Actualizar audioUrl del vocablo ${id}`
    );

    console.log('JSON ACTUALIZADO EN GITHUB:', {
      archivo: path,
      sha: respuestaJSON.content.sha,
      commit: respuestaJSON.commit?.sha
    });

    // 9. Leer nuevamente el JSON desde GitHub.
    // Se obtiene contenido y SHA de la misma versión.
    // Ya no se utiliza download_url.

    etapa = 'verificación del JSON actualizado';

    const verificacion = await obtenerArchivo(
      'diccionario',
      agrupacion,
      true
    );

    const datosVerificados = verificacion.data;

    const registroVerificado = datosVerificados.find(item =>
      String(item.idPalabra) === String(id) &&
      String(item.idDiccionario) === String(variante)
    );

    if (
      !registroVerificado ||
      registroVerificado.audioUrl !== audioUrl
    ) {
      throw new Error(
        `No se pudo verificar audioUrl en ${path} para el vocablo ${id}`
      );
    }

    console.log('VERIFICACIÓN EXITOSA:', {
      idPalabra: registroVerificado.idPalabra,
      idDiccionario: registroVerificado.idDiccionario,
      audioUrl: registroVerificado.audioUrl,
      sha: verificacion.sha
    });

    // 10. La lectura forzada ya actualizó la caché.
    // Se conserva explícitamente la versión verificada.

    const cacheKey = `diccionario_${agrupacion}`;

    cacheData[cacheKey] = datosVerificados;
    cacheSHA[cacheKey] = verificacion.sha;

    return res.json({
      mensaje: 'Audio y audioUrl guardados correctamente',
      audioUrl: registroVerificado.audioUrl,
      archivoJSON: path,
      idPalabra: id,
      idDiccionario: variante,
      bytes: buffer.length,
      verificado: true
    });

  } catch (error) {

    const estadoGitHub = error.response?.status || null;

    const detalleGitHub =
      error.response?.data || null;

    console.error(
      '========== ERROR AL GUARDAR AUDIO ==========',
      {
        etapa,
        mensaje: error.message,
        estadoGitHub,
        detalleGitHub,
        codigoGitHub: error.response?.data?.message,
        erroresGitHub: error.response?.data?.errors
      }
    );

    // Un error de GitHub se devuelve como 502,
    // conservando el estado original en codigoGitHub.

    return res.status(500).json({
      error: 'No fue posible guardar el audio y actualizar el JSON',
      etapa,
      detalle:
        error.response?.data?.message ||
        error.message,
      codigoGitHub: estadoGitHub,
      erroresGitHub:
        error.response?.data?.errors || null,
      respuestaGitHub: detalleGitHub
    });
  }
});

// ==========================================
// REPRODUCIR AUDIO DEL DICCIONARIO
// ==========================================

app.get('/diccionario/:id/audio', async (req, res) => {

  try {

    const { id } = req.params;

    const {
      variante,
      agrupacion,
      formato
    } = req.query;

    const agrupaciones = {
      1: 'zapoteco',
      2: 'chatino'
    };

    const nombreAgrupacion =
      agrupaciones[Number(agrupacion)];

    if (!nombreAgrupacion || !variante || !id) {
      return res.status(400).json({
        error: 'Parámetros de audio incompletos'
      });
    }

    if (!process.env.GITHUB_TOKEN) {
      throw new Error('Falta configurar GITHUB_TOKEN');
    }

    const extensionesDisponibles = [
      'webm',
      'm4a',
      'ogg',
      'mp3',
      'wav'
    ];

    const formatoSolicitado =
      String(formato || '').toLowerCase().trim();

    if (
      formatoSolicitado &&
      !extensionesDisponibles.includes(formatoSolicitado)
    ) {
      return res.status(400).json({
        error: 'Formato de audio no válido'
      });
    }

    const extensiones = formatoSolicitado
      ? [
          formatoSolicitado,
          ...extensionesDisponibles.filter(
            extension => extension !== formatoSolicitado
          )
        ]
      : extensionesDisponibles;

    const tiposMime = {
      webm: 'audio/webm',
      m4a: 'audio/mp4',
      ogg: 'audio/ogg',
      mp3: 'audio/mpeg',
      wav: 'audio/wav'
    };

    let archivoEncontrado = null;
    let extensionEncontrada = null;

    for (const extension of extensiones) {

      const audioPath =
        `audios/${nombreAgrupacion}/${variante}/${id}.${extension}`;

      const githubUrl =
        `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${audioPath
          .split('/')
          .map(segment => encodeURIComponent(segment))
          .join('/')}`;

      try {

        const respuesta = await axios.get(githubUrl, {
          responseType: 'arraybuffer',
          validateStatus: status => status === 200
        });

        if (
          respuesta.data &&
          respuesta.data.byteLength > 0
        ) {
          archivoEncontrado = Buffer.from(respuesta.data);
          extensionEncontrada = extension;
          break;
        }

      } catch (error) {

        if (error.response?.status !== 404) {
          throw error;
        }
      }
    }

    if (!archivoEncontrado) {
      return res.status(404).json({
        error: 'No se encontró el archivo de audio'
      });
    }

    const tamano = archivoEncontrado.length;
    const range = req.headers.range;

    res.set({
      'Content-Type': tiposMime[extensionEncontrada],
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600'
    });

    if (range) {

      const coincidencia =
        /^bytes=(\d*)-(\d*)$/.exec(range);

      if (!coincidencia) {
        return res.status(416).set({
          'Content-Range': `bytes */${tamano}`
        }).end();
      }

      let inicio;
      let fin;

      if (coincidencia[1] === '') {

        const cantidad = Number(coincidencia[2]);

        if (!cantidad || cantidad <= 0) {
          return res.status(416).set({
            'Content-Range': `bytes */${tamano}`
          }).end();
        }

        inicio = Math.max(0, tamano - cantidad);
        fin = tamano - 1;

      } else {

        inicio = Number(coincidencia[1]);

        fin = coincidencia[2]
          ? Number(coincidencia[2])
          : tamano - 1;
      }

      if (
        !Number.isSafeInteger(inicio) ||
        !Number.isSafeInteger(fin) ||
        inicio < 0 ||
        inicio >= tamano ||
        fin < inicio
      ) {
        return res.status(416).set({
          'Content-Range': `bytes */${tamano}`
        }).end();
      }

      fin = Math.min(fin, tamano - 1);

      const fragmento = archivoEncontrado.subarray(
        inicio,
        fin + 1
      );

      res.status(206);

      res.set({
        'Content-Length': fragmento.length,
        'Content-Range': `bytes ${inicio}-${fin}/${tamano}`
      });

      return res.end(fragmento);
    }

    res.set({
      'Content-Length': tamano
    });

    return res.status(200).end(archivoEncontrado);

  } catch (error) {

    console.error(
      'ERROR AL REPRODUCIR AUDIO:',
      error.response?.data || error.message
    );

    res.status(500).json({
      error: 'No fue posible recuperar el audio'
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

    const { data, sha, path } =
      await obtenerArchivo(tipo, agrupacion, true);

    const campoId =
      tipo === 'diccionario' ? 'idPalabra' :
      tipo === 'corpus' ? 'idExpresion' :
      null;

    if (!campoId) {
      return res.status(400).json({
        error: 'Tipo no válido'
      });
    }

    const nuevoId = data.length > 0
      ? Math.max(
          ...data.map(d => Number(d[campoId]) || 0)
        ) + 1
      : 1;

    const nuevoRegistro = {
      ...req.body,
      [campoId]: String(nuevoId)
    };

    data.push(nuevoRegistro);

    const response = await guardarArchivoGitHub(
      path,
      data,
      sha,
      `Nuevo registro en ${tipo}`
    );

    cacheData[`${tipo}_${agrupacion}`] = data;
    cacheSHA[`${tipo}_${agrupacion}`] =
      response.content.sha;

    res.json({
      mensaje: 'Registro creado correctamente'
    });

  } catch (error) {

    console.error(
      'ERROR CREAR REGISTRO:',
      error.response?.data || error.message
    );

    res.status(500).json({
      error: error.response?.data || error.message
    });
  }
});

// ==========================================
// ACTUALIZAR REGISTRO
// ==========================================

app.put('/:tipo/:id', async (req, res) => {

  try {

    const { tipo, id } = req.params;

    const {
      variante,
      agrupacion
    } = req.query;

    if (!agrupacion || !variante) {
      return res.status(400).json({
        error: 'Debe enviar variante y agrupacion'
      });
    }

    const { data, sha, path } =
      await obtenerArchivo(tipo, agrupacion, true);

    const campoId =
      tipo === 'diccionario' ? 'idPalabra' :
      tipo === 'corpus' ? 'idExpresion' :
      null;

    if (!campoId) {
      return res.status(400).json({
        error: 'Tipo no válido'
      });
    }

    const index = data.findIndex(item =>
      String(item[campoId]) === String(id) &&
      String(item.idDiccionario) === String(variante)
    );

    if (index === -1) {
      return res.status(404).json({
        error: 'Registro no encontrado'
      });
    }

    // Conservar el audio anterior.

    const audioAnterior = data[index].audioUrl;

    data[index] = {
      ...data[index],
      ...req.body
    };

    // Evitar que una actualización normal borre el audio.

    if (
      tipo === 'diccionario' &&
      (
        req.body.audioUrl === null ||
        req.body.audioUrl === undefined ||
        req.body.audioUrl === ''
      ) &&
      typeof audioAnterior === 'string' &&
      audioAnterior.trim() !== ''
    ) {
      data[index].audioUrl = audioAnterior;
    }

    const response = await guardarArchivoGitHub(
      path,
      data,
      sha,
      `Actualización en ${tipo} ID ${id}`
    );

    cacheData[`${tipo}_${agrupacion}`] = data;
    cacheSHA[`${tipo}_${agrupacion}`] =
      response.content.sha;

    console.log('REGISTRO ACTUALIZADO:', {
      tipo,
      id,
      variante,
      agrupacion,
      audioUrl: tipo === 'diccionario'
        ? data[index].audioUrl
        : undefined
    });

    res.json({
      mensaje: 'Registro actualizado correctamente',
      audioUrl: tipo === 'diccionario'
        ? data[index].audioUrl || null
        : undefined
    });

  } catch (error) {

    console.error(
      'ERROR ACTUALIZAR REGISTRO:',
      error.response?.data || error.message
    );

    res.status(500).json({
      error: error.response?.data || error.message
    });
  }
});

// ============================
// ELIMINAR REGISTRO
// ============================

app.delete('/:tipo/:id', async (req, res) => {

  try {

    const { tipo, id } = req.params;
    const { agrupacion } = req.query;

    const { data, sha, path } =
      await obtenerArchivo(tipo, agrupacion, true);

    const campoId =
      tipo === 'diccionario' ? 'idPalabra' :
      tipo === 'corpus' ? 'idExpresion' :
      null;

    if (!campoId) {
      return res.status(400).json({
        error: 'Tipo no válido'
      });
    }

    const nuevoArray = data.filter(item =>
      String(item[campoId]) !== String(id)
    );

    const response = await guardarArchivoGitHub(
      path,
      nuevoArray,
      sha,
      `Eliminación en ${tipo}`
    );

    cacheData[`${tipo}_${agrupacion}`] = nuevoArray;
    cacheSHA[`${tipo}_${agrupacion}`] =
      response.content.sha;

    res.json({
      mensaje: 'Registro eliminado correctamente'
    });

  } catch (error) {

    console.error(
      'ERROR ELIMINAR REGISTRO:',
      error.response?.data || error.message
    );

    res.status(500).json({
      error: error.response?.data || error.message
    });
  }
});

// ============================
// GET
// ============================

// GET CON BÚSQUEDA Y PAGINACIÓN

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
      return res.status(400).json({
        error: 'Tipo no válido'
      });
    }

    if (tipo !== 'usuarios' && !agrupacion) {
      return res.status(400).json({
        error: 'Debe enviar agrupacion'
      });
    }

    const { data } = await obtenerArchivo(
      tipo,
      agrupacion || 0,
      tipo === 'diccionario'
    );

    let resultado = Array.isArray(data) ? data : [];

    if (tipo === 'diccionario') {

      resultado = resultado.map(item => ({
        ...item,
        audioUrl:
          typeof item.audioUrl === 'string' &&
          item.audioUrl.trim() !== ''
            ? item.audioUrl.trim()
            : null
      }));

      const audios = resultado.filter(item =>
        typeof item.audioUrl === 'string' &&
        item.audioUrl.trim() !== ''
      );

      console.log(
        '========== DIAGNÓSTICO GET DICCIONARIO =========='
      );

      console.log('Agrupación:', agrupacion);
      console.log('Variante:', variante);
      console.log('Registros recibidos:', resultado.length);
      console.log('Registros con audio:', audios.length);

      console.log(
        'Ejemplos de registros con audio:',
        audios.slice(0, 5).map(item => ({
          idPalabra: item.idPalabra,
          nombrePalabra: item.nombrePalabra,
          audioUrl: item.audioUrl
        }))
      );
    }

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

    const solicitaPaginacion =
      pagina !== undefined ||
      limite !== undefined ||
      q !== undefined;

    if (!solicitaPaginacion) {
      return res.json(resultado);
    }

    const paginaActual = Math.max(
      1,
      parseInt(pagina, 10) || 1
    );

    const limiteSolicitado =
      parseInt(limite, 10) || 100;

    const limiteRegistros = Math.min(
      100,
      Math.max(1, limiteSolicitado)
    );

    const total = resultado.length;

    const inicio =
      (paginaActual - 1) * limiteRegistros;

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

    console.error(
      'Error al consultar registros:',
      error.response?.data || error.message
    );

    res.status(500).json({
      error: error.message
    });
  }
});

// ============================
// SERVIDOR
// ============================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
