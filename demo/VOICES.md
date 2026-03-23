# Demo Video — Voice Configuration

## Selected Voices

### SLICC — Chris (charming, down-to-earth)
- **Voice ID**: `iP95p4xoKVk53GoZ742B`
- **Model**: `eleven_multilingual_v2`
- **Settings**:
  - Stability: 0.3
  - Similarity Boost: 0.75
  - Style: 0.25
  - Speaker Boost: true
- **Direction**: Casual coworker, not an assistant. Contractions always. Filler words OK.

### User — Alexandra (conversational, real)
- **Voice ID**: `kdmDKE6EkgrWrrykO9Qt`
- **Model**: `eleven_multilingual_v2`
- **Settings**:
  - Stability: 0.45
  - Similarity Boost: 0.8
  - Style: 0.15
  - Speaker Boost: true
- **Direction**: Natural, slightly more grounded than SLICC. Higher stability for contrast.

## Rejected Alternatives

| Voice | ID | Role | Notes |
|-------|----|------|-------|
| Eric | `cjVigY5qzO86Huf0OWal` | SLICC | Good but Chris was more down-to-earth |
| Brian | `nPczCjzI2devNBz1zQrb` | SLICC | Too deep/formal |
| Daniel | `onwK4e9ZLuTAKqWW03F9` | SLICC | Too steady/broadcaster |
| Will | `bIHbv24MWmeRgasZH58o` | SLICC | Tested, Chris preferred |
| George | `JBFqnCBsd6RMkjVDRZzb` | User | Switched to female voice |
| Jessica | `cgSgspJ2msm6clMCkdW9` | User | Too playful |
| Laura | `FGY2WhTYpPnrIDTdsKH5` | User | Too quirky |

## ElevenLabs API

```bash
# Generate a line
curl -X POST "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "...",
    "model_id": "eleven_multilingual_v2",
    "voice_settings": { ... }
  }' -o output.mp3
```
