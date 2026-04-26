import io
import re
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image, ImageEnhance, ImageOps, ImageFilter
import pytesseract
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

# Initialize the OpenRouter client using the OpenAI SDK
client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
)

def rgb_to_relative_luminance(r, g, b):
    def channel(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast_ratio(l1, l2):
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def extract_regions_from_image(ocr_image):
    """Helper function to run OCR and group bounding boxes by line."""
    custom_config = r'--psm 11'
    ocr_data = pytesseract.image_to_data(ocr_image, output_type=pytesseract.Output.DICT, config=custom_config)

    lines = {}
    n_boxes = len(ocr_data['text'])

    for i in range(n_boxes):
        text = ocr_data['text'][i].strip()
        try:
            conf = float(ocr_data['conf'][i])
        except ValueError:
            conf = -1

        if text and conf > 30:
            block = ocr_data['block_num'][i]
            par = ocr_data['par_num'][i]
            line = ocr_data['line_num'][i]
            line_key = f"{block}_{par}_{line}"

            x = ocr_data['left'][i]
            y = ocr_data['top'][i]
            w = ocr_data['width'][i]
            h = ocr_data['height'][i]

            if line_key not in lines:
                lines[line_key] = {
                    'x1': x, 'y1': y, 
                    'x2': x + w, 'y2': y + h,
                    'text_parts': [text],
                    'heights': [h] 
                }
            else:
                lines[line_key]['x1'] = min(lines[line_key]['x1'], x)
                lines[line_key]['y1'] = min(lines[line_key]['y1'], y)
                lines[line_key]['x2'] = max(lines[line_key]['x2'], x + w)
                lines[line_key]['y2'] = max(lines[line_key]['y2'], y + h)
                lines[line_key]['text_parts'].append(text)
                lines[line_key]['heights'].append(h)

    regions = []
    for line in lines.values():
        regions.append({
            'x': line['x1'],
            'y': line['y1'],
            'w': line['x2'] - line['x1'],
            'h': line['y2'] - line['y1'],
            'text': " ".join(line['text_parts']),
            'max_word_h': max(line['heights'])
        })
    return regions


def analyze_contrast(image):
    issues = []
    gray_image = image.convert('L')
    
    all_regions = []

    enhancer = ImageEnhance.Contrast(gray_image)
    img_p1 = enhancer.enhance(4.0)
    all_regions.extend(extract_regions_from_image(img_p1))

    img_p2 = ImageOps.invert(gray_image)
    all_regions.extend(extract_regions_from_image(img_p2))

    gray_pixels = list(gray_image.getdata())
    mean_lum = sum(gray_pixels) / len(gray_pixels) if gray_pixels else 128
    img_p3 = gray_image.point(lambda p: 255 if p > mean_lum else 0)
    all_regions.extend(extract_regions_from_image(img_p3))


    final_regions = []
    for r in all_regions:
        is_duplicate = False
        r_box = (r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h'])
        
        for fr in final_regions:
            fr_box = (fr['x'], fr['y'], fr['x'] + fr['w'], fr['y'] + fr['h'])
            
            # Check bounding box collision (Overlap)
            x_left = max(r_box[0], fr_box[0])
            y_top = max(r_box[1], fr_box[1])
            x_right = min(r_box[2], fr_box[2])
            y_bottom = min(r_box[3], fr_box[3])
            
            if x_right > x_left and y_bottom > y_top:
                # They overlap. Because Pass 1 & 2 run first, `final_regions` 
                # already holds the cleanest version of this text.
                # We toss this messy duplicate out.
                is_duplicate = True
                break
                
        if not is_duplicate:
            final_regions.append(r)

    full_ocr_text = "\n".join([r['text'] for r in final_regions])

    if not final_regions:
        return [], full_ocr_text

    width, height = image.size

    for region in final_regions:
        x, y, w, h = region['x'], region['y'], region['w'], region['h']

        padding = 0
        x1 = max(0, x - padding)
        y1 = max(0, y - padding)
        x2 = min(width, x + w + padding)
        y2 = min(height, y + h + padding)

        crop = image.crop((x1, y1, x2, y2))
        crop_pixels = list(crop.getdata())
        
        if not crop_pixels:
            continue

        cleaned_pixels = [p[:3] for p in crop_pixels if len(p) >= 3]

        def perceived_brightness(pixel):
            return 0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2]

        cleaned_pixels.sort(key=perceived_brightness)

        sample_size = max(1, int(len(cleaned_pixels) * 0.02))
        
        dark_pixels = cleaned_pixels[:sample_size]
        light_pixels = cleaned_pixels[-sample_size:]
        
        color_dark = tuple(sum(c[i] for c in dark_pixels) // len(dark_pixels) for i in range(3))
        color_light = tuple(sum(c[i] for c in light_pixels) // len(light_pixels) for i in range(3))

        l_dark = rgb_to_relative_luminance(*color_dark)
        l_light = rgb_to_relative_luminance(*color_light)
        
        ratio = contrast_ratio(l_dark, l_light)
        is_large_text = region['max_word_h'] >= 24

        if ratio < 3:
            issues.append({
                'type': 'contrast',
                'severity': 'critical',
                'text': region['text'][:80], 
                'ratio': round(ratio, 2),
                'required': '3:1 for large text' if is_large_text else '4.5:1 for normal text',
                'actual': f'{ratio:.2f}:1'
            })
        elif ratio < 4.5 and not is_large_text:
            issues.append({
                'type': 'contrast',
                'severity': 'warning',
                'text': region['text'][:80],
                'ratio': round(ratio, 2),
                'required': '4.5:1 for normal text',
                'actual': f'{ratio:.2f}:1'
            })

    return issues, full_ocr_text


def generate_true_ai_descriptions(ocr_text, issues):
    """Uses OpenRouter to synthesize natural language descriptions."""
    if not os.getenv("OPENROUTER_API_KEY"):
        return None, None
        
    try:
        issues_summary = "None"
        if issues:
            issues_summary = f"{len(issues)} text regions have low contrast failing WCAG standards."

        prompt = f"""
        You are an expert in digital accessibility writing alt text for an image.
        Here is the raw text extracted from the image via OCR: "{ocr_text}"
        Contrast Issues detected: {issues_summary}

        Please synthesize this into natural, human-readable descriptions. Ignore repetitive noise like a word being repeated 10 times.
        Format your response EXACTLY like this:
        ALT: [Write a concise 1-sentence alt text for a screen reader here]
        LONG: [Write a detailed description of the text content and mention the contrast issues here]
        """
        
        # Updated to use google/gemini-2.0-flash-001
        response = client.chat.completions.create(
            model="google/gemini-2.0-flash-001", 
            messages=[
                {"role": "user", "content": prompt}
            ]
        )
        
        result = response.choices[0].message.content
        
        alt_match = re.search(r'ALT:\s*(.+?)(?:\n|$)', result)
        long_match = re.search(r'LONG:\s*(.+?)(?:\n|$)', result, re.DOTALL)
        
        alt_text = alt_match.group(1).strip() if alt_match else ""
        long_description = long_match.group(1).strip() if long_match else ""
        
        return alt_text, long_description
        
    except Exception as e:
        print(f"AI Generation Failed: {e}")
        return None, None


def generate_alt_text(ocr_text, issues):
    """Fallback mechanical string generation if AI fails."""
    text = ocr_text.strip() if ocr_text else ''

    if not text:
        if issues:
            return "Image with text that may have low contrast. Review the text content and ensure it meets accessibility standards."
        return "Decorative image or image with no detectable text."

    preview = text.replace('\n', ' ')
    preview = preview[:100] + '...' if len(preview) > 100 else preview
    contrast_note = " Caution: text may have contrast issues." if any(i['severity'] == 'critical' for i in issues) else ""

    return f"(Auto-generated baseline) Text image showing: {preview}.{contrast_note}"


def generate_long_description(ocr_text, issues, image_size):
    """Fallback mechanical string generation if AI fails."""
    text = ocr_text.strip() if ocr_text else ''

    width, height = image_size
    size_note = f" The image is {width}x{height} pixels."

    if not text:
        return f"No text detected in this image.{size_note} Consider adding a description of the visual content for screen readers."

    issue_note = ""
    if issues:
        contrast_issues = [i for i in issues if i['type'] == 'contrast']
        if contrast_issues:
            issue_note = f" Note: {len(contrast_issues)} text region(s) may not meet WCAG contrast requirements (3:1 for large text, 4.5:1 for normal text)."

    formatted_text = text.replace('\n', ' | ')
    return f"(Auto-generated baseline) This image contains text: \"{formatted_text[:200]}\".{size_note}{issue_note}"


@app.route('/analyze', methods=['POST'])
def analyze():
    if 'image' not in request.files:
        return jsonify({'error': 'No image provided'}), 400

    file = request.files['image']
    try:
        image = Image.open(file.stream).convert('RGB')
    except Exception as e:
        return jsonify({'error': f'Invalid image: {str(e)}'}), 400

    issues, ocr_text = analyze_contrast(image)

    # 1. Attempt true AI generation first via OpenRouter
    ai_alt, ai_long = generate_true_ai_descriptions(ocr_text, issues)
    
    # 2. If the API key is missing or the call fails, fall back to our mechanical strings
    alt_text = ai_alt if ai_alt else generate_alt_text(ocr_text, issues)
    long_description = ai_long if ai_long else generate_long_description(ocr_text, issues, image.size)

    return jsonify({
        'ocr_text': ocr_text,
        'issues': issues,
        'alt_text': alt_text,
        'long_description': long_description
    })


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    app.run(debug=True, port=5001)