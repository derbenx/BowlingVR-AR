import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # Listen for all console events and print them
        page.on("console", lambda msg: print(f"Browser console: {msg.text}"))
        # Listen for unhandled exceptions on the page
        page.on("pageerror", lambda exc: print(f"Page error: {exc}"))

        try:
            print("Navigating to page...")
            await page.goto("http://localhost:8000/index.html?test=true", timeout=10000)
            print("Navigation complete.")

            print("Waiting for testModeReady...")
            await page.wait_for_function("window.testModeReady === true", timeout=5000)
            print("testModeReady is true.")

            # 1. Take a screenshot of the initial state (pins standing)
            await page.screenshot(path="jules-scratch/verification/pins_before_tipping.png")
            print("Initial screenshot taken.")

            # 2. Call the new debug function to tip the pins
            print("Calling tipAllPins()...")
            await page.evaluate("window.tipAllPins()")

            # 3. Wait for a moment to let the physics simulation run
            await page.wait_for_timeout(2000) # 2 seconds should be enough for pins to fall

            # 4. Take the final screenshot to verify the result
            await page.screenshot(path="jules-scratch/verification/pins_after_tipping.png")
            print("Verification screenshot taken successfully.")

        except Exception as e:
            print(f"An error occurred: {e}")
            await page.screenshot(path="jules-scratch/verification/error_screenshot.png")
            print("Error screenshot taken.")
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())