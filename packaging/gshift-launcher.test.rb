#!/usr/bin/env ruby
# Runs the real official host with synthetic data, never model weights or user configuration.
require 'fileutils'
require 'json'
require 'minitest/autorun'
require 'open3'
require 'pty'
require 'tmpdir'
require 'timeout'

class BatchLauncherTest < Minitest::Test
  ROOT = File.expand_path('..', __dir__)

  def setup
    @directory = Dir.mktmpdir('launcher-', File.join(ROOT, 'tmp'))
    @temporary = File.join(@directory, 'private runs')
    FileUtils.mkdir_p(@temporary)
    settings = File.join(@directory, 'settings')
    FileUtils.mkdir_p(settings)
    @environment = {
      'TMPDIR' => @temporary, 'HOME' => settings, 'XDG_CONFIG_HOME' => settings,
      'XDG_CACHE_HOME' => settings, 'GLOSSSHIFT_CONFIG' => File.join(settings, 'absent.json')
    }
    @coreutils = ENV.fetch('GLOSSSHIFT_TEST_COREUTILS')
    fixture = File.join(@directory, 'bundle.js')
    FileUtils.cp(File.join(__dir__, 'batch.fixture.js'), fixture)
    capabilities = JSON.parse(File.read(File.join(ROOT, 'batch/nsh.json'))).fetch('capabilities')
    File.write(File.join(@directory, 'capabilities.json'), JSON.generate(capabilities))
    host = ENV.fetch('GLOSSSHIFT_TEST_TUI_HOST')
    @launcher = File.join(@directory, 'gshift')
    replacements = {
      '@shell@' => '/bin/sh', '@runtimeEnvironment@' => '', '@host@' => host,
      '@tuiBundle@' => fixture, '@batchBundle@' => fixture,
      '@mktemp@' => tool('mktemp'), '@rm@' => tool('rm'), '@cat@' => tool('cat'), '@jq@' => tool('jq'),
      '@cp@' => tool('cp'), '@realpath@' => File.join(File.dirname(@coreutils), 'realpath'),
      '@capabilities@' => File.join(@directory, 'capabilities.json')
    }
    source = File.read(File.join(__dir__, 'gshift-launcher.sh'))
    replacements.each { |key, value| source = source.gsub(key, value) }
    File.write(@launcher, source)
    File.chmod(0o700, @launcher)
  end

  def teardown
    FileUtils.remove_entry(@directory)
  end

  def tool(name)
    path = ENV.fetch('PATH').split(File::PATH_SEPARATOR).map { |entry| File.join(entry, name) }
              .find { |candidate| File.executable?(candidate) && !File.directory?(candidate) }
    raise "Missing #{name}" unless path
    path
  end

  def invoke(*args)
    Open3.capture3(@environment, @launcher, *args, chdir: @directory)
  end

  def test_quoted_arguments_cwd_clean_streams_and_private_cleanup
    arguments = ['success', 'spaces and "quotes".md', "new\nline.md", '$(touch never-created)', '--lang', 'ja', '--stdout']
    stdout, stderr, status = invoke(*arguments)
    assert_equal 0, status.exitstatus
    assert_equal({ 'args' => arguments, 'cwd' => File.realpath(@directory) }, JSON.parse(stdout))
    assert_equal "synthetic diagnostic\n", stderr
    refute_includes stdout, "\e"
    refute_includes stderr, "\e"
    refute File.exist?(File.join(@directory, 'never-created'))
    assert_empty Dir.children(@temporary)
  end

  def test_status_file_preserves_nonzero_status_despite_native_exit_zero
    stdout, stderr, status = invoke('failure')
    assert_equal 7, status.exitstatus
    assert_equal ['failure'], JSON.parse(stdout).fetch('args')
    assert_equal "synthetic diagnostic\n", stderr
    assert_empty Dir.children(@temporary)
  end

  def test_missing_completion_is_failure_not_success
    stdout, stderr, status = invoke('missing-status')
    assert_equal 1, status.exitstatus
    assert_empty stdout
    assert_includes stderr, 'did not report completion'
    assert_empty Dir.children(@temporary)
  end

  def test_invalid_completion_is_rejected
    _, stderr, status = invoke('invalid-status')
    assert_equal 1, status.exitstatus
    assert_includes stderr, 'invalid status'
    assert_empty Dir.children(@temporary)
  end

  def test_working_directory_with_trailing_newline_is_preserved
    directory = File.join(@directory, "cwd\n")
    FileUtils.mkdir_p(directory)
    stdout, _, status = Open3.capture3(@environment, @launcher, 'success', chdir: directory)
    assert_equal 0, status.exitstatus
    assert_equal File.realpath(directory), JSON.parse(stdout).fetch('cwd')
  end

  def test_inherited_transport_and_path_cannot_override_private_run
    outside = File.join(@directory, 'must-not-be-written')
    environment = {
      'TMPDIR' => @temporary, 'PATH' => '/does-not-exist',
      'GLOSSSHIFT_BATCH_ARGS' => '["injected"]', 'GLOSSSHIFT_BATCH_CWD' => '/injected',
      'GLOSSSHIFT_BATCH_STDOUT' => outside, 'GLOSSSHIFT_BATCH_STDERR' => outside,
      'GLOSSSHIFT_BATCH_STATUS' => outside
    }
    stdout, stderr, status = Open3.capture3(@environment.merge(environment), @launcher, 'success', chdir: @directory)
    assert_equal 0, status.exitstatus
    assert_equal ['success'], JSON.parse(stdout).fetch('args')
    assert_equal "synthetic diagnostic\n", stderr
    refute File.exist?(outside)
    assert_empty Dir.children(@temporary)
  end

  def test_termination_releases_host_and_private_directory
    Open3.popen3(@environment, @launcher, 'interrupted', chdir: @directory) do |stdin, stdout, stderr, waiter|
      stdin.close
      Timeout.timeout(5) do
        loop do
          runs = Dir.glob(File.join(@temporary, '*', 'stdout'))
          break if runs.any? { |file| File.size(file).positive? }
          sleep 0.01
        end
        Process.kill('TERM', waiter.pid)
        assert_equal 143, waiter.value.exitstatus
        assert_empty stdout.read
        assert_empty stderr.read
      end
    end
    assert_empty Dir.children(@temporary)
  end

  def test_private_capability_file_has_only_request_scoped_roots
    stdout, stderr, status = invoke('capabilities')
    assert_equal 0, status.exitstatus
    assert_empty stderr
    roots = JSON.parse(stdout)
    roots.values.flatten.each do |path|
      refute_equal '/', path
      assert path.start_with?(File.realpath(@directory) + '/') || path == File.realpath(@directory), path
    end
    refute_includes roots.fetch('write'), File.join(@directory, 'settings', 'absent.json')
    assert_empty Dir.children(@temporary)
  end

  def test_autostart_grants_registration_write_and_explicit_application_read_only
    app = File.join(@directory, 'Approved App.app')
    stdout, stderr, result = invoke('--autostart', 'enable', '--app', app)
    assert_equal 0, result.exitstatus
    assert_empty stderr
    roots = JSON.parse(stdout)
    home = File.realpath(@environment.fetch('HOME'))
    registration = File.join(home, 'Library', 'LaunchAgents')
    assert_includes roots.fetch('read'), app
    assert_includes roots.fetch('read'), home
    assert_includes roots.fetch('write'), registration
    refute_includes roots.fetch('write'), home
    refute_includes roots.fetch('write'), app
    refute_includes roots.fetch('write'), File.realpath(@directory)
    refute roots.values.flatten.any? { |path| path.include?('/.cache/') || path.end_with?('/enable') }
    assert_empty Dir.children(@temporary)
  end

  def test_autostart_status_reads_only_the_stored_application_bundle
    home = @environment.fetch('HOME')
    directory = File.join(home, 'Library', 'LaunchAgents')
    FileUtils.mkdir_p(directory)
    app = File.join(@directory, 'Stored App.app')
    File.write(File.join(directory, 'com.totto2727.glossshift.plist'), <<~PLIST)
      <?xml version="1.0" encoding="UTF-8"?>
      <plist version="1.0"><dict><key>ProgramArguments</key><array>
      <string>/usr/bin/open</string><string>-g</string><string>#{app}</string>
      </array></dict></plist>
    PLIST
    stdout, stderr, result = invoke('--autostart', 'status')
    assert_equal 0, result.exitstatus
    assert_empty stderr
    roots = JSON.parse(stdout)
    assert_includes roots.fetch('read'), app
    refute_includes roots.fetch('write'), app
    refute_includes roots.fetch('write'), File.realpath(@directory)
    assert_empty Dir.children(@temporary)
  end

  def test_redirected_stdout_overrides_an_inherited_true_terminal_flag
    stdout, stderr, result = Open3.capture3(@environment.merge('GLOSSSHIFT_BATCH_STDOUT_IS_TTY' => '1'), @launcher, 'tty', chdir: @directory)
    assert_equal 0, result.exitstatus
    assert_equal '0', stdout
    assert_empty stderr
  end

  def test_terminal_stdout_is_reported_without_terminal_renderer_escapes
    output = +''
    result = nil
    Timeout.timeout(5) do
      PTY.spawn(@environment, @launcher, 'tty', chdir: @directory) do |reader, writer, pid|
        writer.close
        begin
          loop { output << reader.readpartial(4096) }
        rescue EOFError, Errno::EIO
          # The terminal closes when the wrapper exits.
        end
        _, result = Process.wait2(pid)
      end
    end
    assert_equal 0, result.exitstatus
    assert_equal '1', output
    refute_includes output, "\e"
    assert_empty Dir.children(@temporary)
  end

  def test_production_cli_help_version_and_invalid_arguments
    bundle = ENV['GLOSSSHIFT_TEST_BATCH_BUNDLE']
    coreutils = @coreutils
    skip 'Set GLOSSSHIFT_TEST_BATCH_BUNDLE after nsh build batch' unless bundle
    FileUtils.cp(bundle, File.join(@directory, 'bundle.js'))
    capabilities_file = File.join(@directory, 'capabilities.json')
    capabilities = JSON.parse(File.read(capabilities_file))
    capabilities['process']['execute'] = [coreutils]
    File.write(capabilities_file, JSON.generate(capabilities))
    settings = File.join(@directory, 'settings')
    FileUtils.mkdir_p(settings)
    environment = {
      'TMPDIR' => @temporary, 'GLOSSSHIFT_COREUTILS' => coreutils, 'HOME' => settings,
      'XDG_CONFIG_HOME' => settings, 'XDG_CACHE_HOME' => settings,
      'GLOSSSHIFT_CONFIG' => File.join(settings, 'absent.json')
    }
    [['--help', 0, 'Usage: gshift'], ['--version', 0, 'gshift 0.2.0'], ['--invalid-option', 1, 'gshift failed:']].each do |argument, code, message|
      stdout, stderr, result = Open3.capture3(environment, @launcher, argument, chdir: @directory)
      assert_equal code, result.exitstatus, stderr
      assert_includes code.zero? ? stdout : stderr, message
      assert_empty code.zero? ? stderr : stdout
      refute_includes stdout + stderr, "\e"
      assert_empty Dir.children(settings)
      assert_empty Dir.children(@temporary)
    end
  end
end
