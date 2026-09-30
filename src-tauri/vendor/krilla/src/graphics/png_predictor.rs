use pdf_writer::{Dict, Name, Null};
use png::{BitDepth, ColorType};

// Writer patch: use the existing PNG encoder for its tested adaptive row filters,
// then retain only IDAT (a single zlib stream) for PDF FlateDecode / Predictor 15.
pub(crate) fn encode_png_channel(
    data: &[u8],
    size: (u32, u32),
    components: u8,
) -> Result<Vec<u8>, String> {
    let mut png = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png, size.0, size.1);
        encoder.set_color(match components {
            1 => ColorType::Grayscale,
            3 => ColorType::Rgb,
            _ => return Err("unsupported PNG predictor color space".into()),
        });
        encoder.set_depth(BitDepth::Eight);
        // Keep adaptive filtering with fewer DEFLATE search passes for large,
        // image-heavy documents.
        encoder.set_deflate_compression(png::DeflateCompression::Level(3));
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(data).map_err(|e| e.to_string())?;
        writer.finish().map_err(|e| e.to_string())?;
    }
    // This is newly encoded, trusted PNG data, not a parser for user input.
    let mut encoded = Vec::with_capacity(png.len());
    let mut rest = &png[8..];
    while !rest.is_empty() {
        let length = u32::from_be_bytes(rest[..4].try_into().unwrap()) as usize;
        if &rest[4..8] == b"IDAT" {
            encoded.extend_from_slice(&rest[8..8 + length]);
        }
        rest = &rest[12 + length..];
    }
    Ok(encoded)
}

pub(crate) fn write_png_predictor(dict: &mut Dict<'_>, width: u32, components: u8, ascii: bool) {
    let params = |mut dict: Dict<'_>| {
        dict.pair(Name(b"Predictor"), 15);
        dict.pair(Name(b"Colors"), i32::from(components));
        dict.pair(Name(b"BitsPerComponent"), 8);
        dict.pair(Name(b"Columns"), width as i32);
    };
    if ascii {
        // ASCIIHexDecode precedes FlateDecode, so its parameter slot is null.
        let mut array = dict.insert(Name(b"DecodeParms")).array();
        array.item(Null);
        params(array.push().dict());
    } else {
        params(dict.insert(Name(b"DecodeParms")).dict());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pdf_writer::Finish;
    use std::io::Cursor;

    #[test]
    fn filtered_channels_round_trip_with_the_png_decoder() {
        for components in [1, 3] {
            for (width, height) in [(1, 1), (1, 257), (257, 1), (257, 31)] {
                let mut seed = 7u32;
                let data: Vec<u8> = (0..width * height * u32::from(components))
                    .map(|_| {
                        seed ^= seed << 13;
                        seed ^= seed >> 17;
                        seed ^= seed << 5;
                        seed as u8
                    })
                    .collect();
                let idat = encode_png_channel(&data, (width, height), components).unwrap();
                // The independent decoder applies the actual PNG filter semantics.
                let mut png = Vec::new();
                {
                    let mut encoder = png::Encoder::new(&mut png, width, height);
                    encoder.set_depth(BitDepth::Eight);
                    encoder.set_color(if components == 1 {
                        ColorType::Grayscale
                    } else {
                        ColorType::Rgb
                    });
                    let mut writer = encoder.write_header().unwrap();
                    writer.write_chunk(png::chunk::IDAT, &idat).unwrap();
                    writer.finish().unwrap();
                }
                let mut decoder = png::Decoder::new(Cursor::new(png)).read_info().unwrap();
                let mut decoded = vec![0; decoder.output_buffer_size().unwrap()];
                let info = decoder.next_frame(&mut decoded).unwrap();
                assert_eq!(&decoded[..info.buffer_size()], data);
            }
        }
    }

    #[test]
    fn decode_parameters_follow_the_filter_order() {
        for ascii in [false, true] {
            let mut pdf = pdf_writer::Pdf::new();
            let mut dict = pdf.indirect(pdf_writer::Ref::new(1)).dict();
            write_png_predictor(&mut dict, 1200, 3, ascii);
            dict.finish();
            let bytes = pdf.finish();
            let output = String::from_utf8_lossy(&bytes);
            assert!(output.contains("/Predictor 15"));
            assert!(output.contains("/Columns 1200") && output.contains("/Colors 3"));
            assert!(output.contains("/BitsPerComponent 8"));
            assert_eq!(output.contains("/DecodeParms [null"), ascii);
        }
    }

    #[test]
    fn invalid_channel_dimensions_and_color_spaces_return_errors() {
        assert!(encode_png_channel(&[], (0, 1), 1).is_err());
        assert!(encode_png_channel(&[1], (2, 1), 1).is_err());
        assert!(encode_png_channel(&[1, 2, 3, 4], (1, 1), 4).is_err());
    }
}
