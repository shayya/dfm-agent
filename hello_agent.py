import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions
from dotenv import load_dotenv

load_dotenv()

async def main():
    async for message in query(
        prompt="What is 2 + 2? Explain your reasoning briefly.",
        options=ClaudeAgentOptions(),
    ):
        print(message)

asyncio.run(main())