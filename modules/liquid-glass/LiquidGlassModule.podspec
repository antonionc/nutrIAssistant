require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'LiquidGlassModule'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = { :type => 'MIT' }
  s.author         = { 'nutrIAssistant' => 'dev@nutriassistant.com' }
  s.homepage       = 'https://github.com/dev/nutriassistant'
  s.platform       = :ios, '26.0'
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.dependency 'ExpoModulesCore'

  s.source_files = 'ios/**/*.{swift,h,m}'
end
