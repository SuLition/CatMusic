use std::{env, process::Command};

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "CatMusic";

pub fn apply(enabled: bool) -> Result<(), String> {
    if enabled {
        add_run_value()
    } else {
        remove_run_value()
    }
}

fn add_run_value() -> Result<(), String> {
    let command = startup_command()?;
    run_reg(&[
        "add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", &command, "/f",
    ])
}

fn remove_run_value() -> Result<(), String> {
    let output = Command::new("reg")
        .args(["delete", RUN_KEY, "/v", RUN_VALUE, "/f"])
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() || !is_run_value_present() {
        Ok(())
    } else {
        Err(command_error("reg delete", &output))
    }
}

fn is_run_value_present() -> bool {
    Command::new("reg")
        .args(["query", RUN_KEY, "/v", RUN_VALUE])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn startup_command() -> Result<String, String> {
    let exe = env::current_exe().map_err(|error| error.to_string())?;
    Ok(format!("\"{}\"", exe.to_string_lossy()))
}

fn run_reg(args: &[&str]) -> Result<(), String> {
    let output = Command::new("reg")
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(command_error("reg", &output))
    }
}

fn command_error(command: &str, output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if !stderr.is_empty() {
        format!("{command} failed: {stderr}")
    } else if !stdout.is_empty() {
        format!("{command} failed: {stdout}")
    } else {
        format!("{command} failed with status {}", output.status)
    }
}
