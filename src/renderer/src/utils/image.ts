export async function cropAndPadTransparent(
  base64: string,
  finalSize = 256,
  border = 24
): Promise<string> {
  const img = new Image()
  img.src = base64
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = reject
  })

  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to get 2D context')
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0)

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)

  const { data, width, height } = imgData
  let top = height,
    bottom = 0,
    left = width,
    right = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4 + 3
      if (data[i] > 10) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }

  if (right < left || bottom < top) return base64

  const cropWidth = right - left + 1
  const cropHeight = bottom - top + 1
  const contentSize = finalSize - 2 * border

  const aspectRatio = cropWidth / cropHeight
  let drawWidth = contentSize
  let drawHeight = contentSize
  let offsetX = border
  let offsetY = border

  if (aspectRatio > 1) {
    drawHeight = contentSize / aspectRatio
    offsetY = border + (contentSize - drawHeight) / 2
  } else {
    drawWidth = contentSize * aspectRatio
    offsetX = border + (contentSize - drawWidth) / 2
  }

  const outCanvas = document.createElement('canvas')
  outCanvas.width = finalSize
  outCanvas.height = finalSize
  const outCtx = outCanvas.getContext('2d')
  if (!outCtx) {
    throw new Error('Failed to get 2D context')
  }
  outCtx.clearRect(0, 0, finalSize, finalSize)
  outCtx.drawImage(
    canvas,
    left,
    top,
    cropWidth,
    cropHeight,
    offsetX,
    offsetY,
    drawWidth,
    drawHeight
  )

  return outCanvas.toDataURL('image/png')
}
