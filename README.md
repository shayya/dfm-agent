# DFM Agent

An AI agent that analyzes CAD files for **Design for Manufacturability (DFM)** issues — flagging geometry that will be expensive, slow, or impossible to machine before it hits the shop floor.

Built on the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview) with [pythonOCC](https://github.com/tpaviot/pythonocc-core) for CAD parsing.

## Why

Manufacturing engineers spend hours reviewing parts for DFM problems that are often obvious once you see them — wall thickness too thin, holes too deep, undercuts that need a custom tool. This project explores whether an agent can do that first pass automatically, catching issues at the design stage when they're cheap to fix.

Background: I spent 7 years as a manufacturing engineer at Parker Hannifin before pivoting to AI. This is the first flagship of that pivot.

## Status

🚧 **Early development.** Day 4 of a 6-month build.

**Working:**
- `list_features.py` — parses STEP files and returns topology counts (faces, edges, vertices)

**Next:**
- Wrap `list_features` as a Claude Agent SDK tool
- Add geometry analysis tools (hole detection, wall thickness, draft angles)
- Agent loop that selects tools based on part characteristics
- Structured DFM report output

## Stack

- **Language:** Python 3.11
- **Agent framework:** Claude Agent SDK
- **CAD parsing:** pythonOCC (OpenCASCADE bindings)
- **Env:** conda (pythonOCC isn't pip-installable)

## Running locally

Requires [miniconda](https://docs.conda.io/en/latest/miniconda.html) and an Anthropic API key.

```bash
# Clone
git clone https://github.com/shayya/dfm-agent.git
cd dfm-agent

# Environment
conda create -n dfm python=3.11 -y
conda activate dfm
conda install -c conda-forge pythonocc-core -y
pip install anthropic claude-agent-sdk python-dotenv

# API key
echo "ANTHROPIC_API_KEY=your-key-here" > .env

# Run the feature lister on a sample part
python list_features.py
```

## Building in public

I'm documenting this build day-by-day as part of a 6-month transition into AI agent engineering. Follow along:

- **LinkedIn:** linkedin.com/in/snirenberg
- **GitHub:** [@shayya](https://github.com/shayya)

## License

MIT