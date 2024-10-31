import sharp from "sharp"

/**
 * Creates white tiffs with red numbers in the specified path.
 *
 * @param {string} base_path - Output path
 * @param {number} count - Number of times
 * @param {number} width - image width
 * @param {number} height - image height
 * @param {string} prefix - Prefix of the file name
 * @param {string} extension - File extension (only .tif and .tiff are supported)
 * @param {string} font - Font and Font Size
 * @param {number} top - initial top position of the number
 * @param {number} left - initial left position of the number
 * @param {number} offset - offset added to the position of the number times the number
 */

export default async function generate_images(base_path, count = 100, width = 1920, height = 1080, prefix = "test_", extension = ".tiff", font = "NotoSans 36", top = 200, left = 200, offset = 10) {
    let background = sharp({
        create: {
            width,
            height,
            channels: 3,
            background: { r: 255, g: 255, b: 255 }
        }
    }
    )
        .toColourspace('rgb16')
        .tiff({
            compression: 'lzw'
        })
    for (let i = 1; i <= count; i++) {
        let text = await sharp({
            text: {
                text: i.toString(),
                font,
                dpi: 600
            }
        })
            .negate()
            .tiff()
            .toBuffer()

        await background.clone()
            .composite([{
                input: text,
                top: top + i * offset % top,
                left: left + i * offset % left
            }])
            .linear([1, 1, 1], [255, 0, 0])
            .toFile(base_path + '/' + prefix + i + extension)
    }
}

generate_images(import.meta.dirname)