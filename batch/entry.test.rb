#!/usr/bin/env ruby
# Exercises the production NSH batch entry with synthetic, isolated files and no model download.
require 'fileutils'
require 'json'
require 'minitest/autorun'
require 'open3'
require 'tmpdir'
require 'timeout'

class BatchEntryTest < Minitest::Test
  ROOT = File.expand_path('..', __dir__)

  def setup
    @directory = Dir.mktmpdir('entry-', File.join(ROOT, 'tmp'))
    bundle = ENV.fetch('GLOSSSHIFT_TEST_BATCH_BUNDLE')
    @host = ENV.fetch('GLOSSSHIFT_TEST_TUI_HOST')
    @tools = ENV.fetch('GLOSSSHIFT_COREUTILS')
    FileUtils.cp(bundle, File.join(@directory, 'bundle.js'))
    capabilities = JSON.parse(File.read(File.join(File.dirname(bundle), 'capabilities.json')))
    capabilities.fetch('process')['execute'] = [@tools]
    capabilities.fetch('fs')['read'] = [@directory]
    capabilities.fetch('fs')['write'] = [@directory]
    File.write(File.join(@directory, 'capabilities.json'), JSON.generate(capabilities))
  end

  def teardown
    FileUtils.remove_entry(@directory)
  end

  def invoke(*args)
    stdout = File.join(@directory, 'stdout')
    stderr = File.join(@directory, 'stderr')
    status = File.join(@directory, 'status')
    File.write(stdout, '')
    File.write(stderr, '')
    environment = {
      'GLOSSSHIFT_BATCH_ARGS' => JSON.generate(args), 'GLOSSSHIFT_BATCH_CWD' => @directory,
      'GLOSSSHIFT_BATCH_STDOUT' => stdout, 'GLOSSSHIFT_BATCH_STDERR' => stderr,
      'GLOSSSHIFT_BATCH_STATUS' => status, 'GLOSSSHIFT_COREUTILS' => @tools,
      'GLOSSSHIFT_CONFIG' => File.join(@directory, 'local.json'),
      'XDG_CONFIG_HOME' => File.join(@directory, 'config'),
      'XDG_CACHE_HOME' => File.join(@directory, 'cache')
    }
    host_stdout, host_stderr, result = Timeout.timeout(30) do
      Open3.capture3(environment, @host, '--headless', '--bundle', File.join(@directory, 'bundle.js'),
                     '--log-file', File.join(@directory, 'host.log'), chdir: @host_directory || @directory)
    end
    assert_equal '', host_stdout
    assert_equal '', host_stderr
    assert File.file?(status), 'production entry did not publish completion'
    [File.read(stdout), File.read(stderr), File.read(status), result.exitstatus]
  end

  def assert_model_free
    refute File.exist?(File.join(@directory, 'local.json'))
    refute File.exist?(File.join(@directory, 'config'))
    refute File.exist?(File.join(@directory, 'cache'))
  end

  def test_help_is_model_free_and_exactly_separated_from_diagnostics
    out, err, status, code = invoke('--help')
    assert_match(/Usage: gshift <FILES>/, out)
    assert_equal '', err
    assert_equal "0\n", status
    assert_equal 0, code
    assert_model_free
  end

  def test_version_is_exact_and_model_free
    out, err, status, code = invoke('--version')
    assert_equal "gshift 0.2.0\n", out
    assert_equal '', err
    assert_equal "0\n", status
    assert_equal 0, code
    assert_model_free
  end

  def test_invalid_arguments_publish_failure_without_loading_configuration
    out, err, status, = invoke('missing.md')
    assert_equal '', out
    assert_equal "gshift failed: --lang is required\n", err
    assert_equal "1\n", status
    assert_model_free
  end

  def test_existing_output_is_not_overwritten_or_loaded_as_a_model
    File.write(File.join(@directory, 'guide.md'), 'synthetic source')
    output = File.join(@directory, 'guide.ja.md')
    File.write(output, 'preserve output')
    out, err, status, = invoke('guide.md', '--lang', 'ja')
    assert_equal '', out
    assert_match(/already exists; pass --force/, err)
    assert_equal "1\n", status
    assert_equal 'preserve output', File.read(output)
    assert_model_free
  end

  def test_output_symlink_is_rejected_without_modifying_its_target
    File.write(File.join(@directory, 'guide.md'), 'synthetic source')
    target = File.join(@directory, 'target.md')
    File.write(target, 'preserve target')
    output = File.join(@directory, 'guide.ja.md')
    File.symlink(target, output)
    out, err, status, = invoke('guide.md', '--lang', 'ja')
    assert_equal '', out
    assert_match(/symbolic link/, err)
    assert_equal "1\n", status
    assert File.symlink?(output)
    assert_equal 'preserve target', File.read(target)
    assert_model_free
  end

  def test_dangling_output_symlink_is_not_followed_or_replaced_without_force
    File.write(File.join(@directory, 'guide.md'), 'synthetic source')
    target = File.join(@directory, 'missing.md')
    output = File.join(@directory, 'guide.ja.md')
    File.symlink(target, output)
    out, err, status, = invoke('guide.md', '--lang', 'ja')
    assert_equal '', out
    assert_match(/symbolic link/, err)
    assert_equal "1\n", status
    assert File.symlink?(output)
    refute File.exist?(target)
    assert_model_free
  end

  def test_collision_failure_precedes_configuration_or_model_initialization
    # A GUI host may start elsewhere. Only the wrapper's original cwd defines relative inputs.
    @host_directory = ROOT
    File.write(File.join(@directory, 'guide.md'), 'synthetic original')
    File.write(File.join(@directory, 'guide.ja.md'), 'synthetic other input')
    out, err, status, = invoke('guide.md', 'guide.ja.md', '--lang', 'ja', '--force')
    assert_equal '', out
    assert_match(/also an input file/, err)
    assert_includes err, File.join(@directory, 'guide.ja.md')
    assert_equal "1\n", status
    assert_equal 'synthetic original', File.read(File.join(@directory, 'guide.md'))
    assert_equal 'synthetic other input', File.read(File.join(@directory, 'guide.ja.md'))
    assert_model_free
  end
end
