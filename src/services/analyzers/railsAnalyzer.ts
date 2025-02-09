import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

interface RailsSymbol {
    name: string;
    type: 'controller' | 'model' | 'mailer' | 'job' | 'helper' | 'concern' | 'service' | 'validator' | 'serializer' | 'view';
    path?: string;
    methods?: string[];
    attributes?: string[];
    associations?: string[];
    validations?: string[];
    callbacks?: string[];
    dependencies?: string[];
    metadata?: any;
    documentation?: string;
    location: {
        line: number;
        column: number;
        endLine: number;
        endColumn: number;
    };
}

export class RailsAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        const content = document.getText();
        const result = await this.analyzeRailsContent(content);
        this.analysisCache.set(filePath, result);
        return result;
    }

    private async analyzeRailsContent(content: string): Promise<AnalysisResult> {
        try {
            // Ruby analiz script'ini oluştur
            const rubyScript = `
require 'parser/current'
require 'json'

class RailsAnalyzer < Parser::AST::Processor
  attr_reader :symbols, :complexity, :dependencies
  
  def initialize
    @symbols = {}
    @complexity = 0
    @dependencies = {}
    @current_class = nil
  end
  
  def on_class(node)
    name = node.children[0].children[1]
    @current_class = name
    
    symbol = {
      type: get_class_type(node),
      name: name,
      line: node.loc.line,
      column: node.loc.column,
      end_line: node.loc.last_line,
      end_column: node.loc.last_column,
      documentation: get_documentation(node)
    }
    
    case symbol[:type]
    when 'controller'
      symbol[:methods] = get_controller_methods(node)
      symbol[:callbacks] = get_controller_callbacks(node)
    when 'model'
      symbol[:attributes] = get_model_attributes(node)
      symbol[:associations] = get_model_associations(node)
      symbol[:validations] = get_model_validations(node)
      symbol[:callbacks] = get_model_callbacks(node)
    when 'mailer'
      symbol[:methods] = get_mailer_methods(node)
      symbol[:templates] = get_mailer_templates(node)
    when 'job'
      symbol[:queue] = get_job_queue(node)
      symbol[:callbacks] = get_job_callbacks(node)
    when 'helper'
      symbol[:methods] = get_helper_methods(node)
    when 'concern'
      symbol[:included_methods] = get_concern_methods(node)
      symbol[:callbacks] = get_concern_callbacks(node)
    when 'service'
      symbol[:methods] = get_service_methods(node)
      symbol[:dependencies] = get_service_dependencies(node)
    when 'validator'
      symbol[:attributes] = get_validator_attributes(node)
      symbol[:methods] = get_validator_methods(node)
    when 'serializer'
      symbol[:attributes] = get_serializer_attributes(node)
      symbol[:associations] = get_serializer_associations(node)
    end
    
    @symbols[name] = symbol
    process(node.children[2])
    @current_class = nil
  end
  
  def get_class_type(node)
    superclass = node.children[1]
    return 'class' unless superclass
    
    superclass_name = superclass.children[1].to_s
    case superclass_name
    when /ApplicationController$/, /ActionController::Base$/
      'controller'
    when /ApplicationRecord$/, /ActiveRecord::Base$/
      'model'
    when /ApplicationMailer$/, /ActionMailer::Base$/
      'mailer'
    when /ApplicationJob$/, /ActiveJob::Base$/
      'job'
    when /ActiveModel::Validator$/
      'validator'
    when /ActiveModel::Serializer$/
      'serializer'
    else
      if superclass_name.end_with?('Helper')
        'helper'
      elsif node.children[2].to_s.include?('include ActiveSupport::Concern')
        'concern'
      elsif node.children[2].to_s.include?('include Service')
        'service'
      else
        'class'
      end
    end
  end
  
  def get_documentation(node)
    comments = []
    node.loc.expression.source_buffer.source_lines[0...node.loc.line].reverse_each do |line|
      break unless line.strip.start_with?('#')
      comments.unshift(line.strip)
    end
    comments.join("\\n")
  end
  
  def get_controller_methods(node)
    methods = []
    node.children[2].each_node(:def) do |method_node|
      next if method_node.children[0].to_s.start_with?('_')
      methods << {
        name: method_node.children[0],
        route: get_route_info(method_node)
      }
    end
    methods
  end
  
  def get_route_info(node)
    route_methods = %w(get post put patch delete)
    node.each_node(:send) do |send_node|
      if route_methods.include?(send_node.children[1].to_s)
        return {
          method: send_node.children[1],
          path: send_node.children[2].children[0]
        }
      end
    end
    nil
  end
  
  def get_controller_callbacks(node)
    callbacks = []
    %w(before_action after_action around_action).each do |callback|
      node.each_node(:send) do |send_node|
        if send_node.children[1].to_s == callback
          callbacks << {
            type: callback,
            method: send_node.children[2].children[0]
          }
        end
      end
    end
    callbacks
  end
  
  def get_model_attributes(node)
    attributes = []
    node.each_node(:send) do |send_node|
      if send_node.children[1].to_s == 'attribute'
        attributes << {
          name: send_node.children[2].children[0],
          type: send_node.children[3]&.children&.[](0)
        }
      end
    end
    attributes
  end
  
  def get_model_associations(node)
    associations = []
    %w(belongs_to has_many has_one has_and_belongs_to_many).each do |assoc|
      node.each_node(:send) do |send_node|
        if send_node.children[1].to_s == assoc
          associations << {
            type: assoc,
            name: send_node.children[2].children[0],
            options: get_association_options(send_node)
          }
        end
      end
    end
    associations
  end
  
  def get_association_options(node)
    return {} unless node.children[3]
    
    options = {}
    node.children[3].children.each_slice(2) do |key, value|
      options[key.children[0]] = value.children[0]
    end
    options
  end
  
  def get_model_validations(node)
    validations = []
    node.each_node(:send) do |send_node|
      if send_node.children[1].to_s.start_with?('validates')
        validations << {
          type: send_node.children[1],
          attributes: send_node.children[2..-1].map { |c| c.children[0] }
        }
      end
    end
    validations
  end
  
  def get_model_callbacks(node)
    callbacks = []
    %w(before_save after_save before_create after_create before_update after_update before_destroy after_destroy).each do |callback|
      node.each_node(:send) do |send_node|
        if send_node.children[1].to_s == callback
          callbacks << {
            type: callback,
            method: send_node.children[2].children[0]
          }
        end
      end
    end
    callbacks
  end
  
  def get_mailer_methods(node)
    methods = []
    node.children[2].each_node(:def) do |method_node|
      next if method_node.children[0].to_s.start_with?('_')
      methods << {
        name: method_node.children[0],
        template: get_mailer_template(method_node)
      }
    end
    methods
  end
  
  def get_mailer_template(node)
    node.each_node(:send) do |send_node|
      if send_node.children[1].to_s == 'mail'
        return send_node.children[2].children[0]
      end
    end
    nil
  end
  
  def get_mailer_templates(node)
    templates = []
    node.each_node(:send) do |send_node|
      if send_node.children[1].to_s == 'template_path'
        templates << send_node.children[2].children[0]
      end
    end
    templates
  end
  
  def get_job_queue(node)
    node.each_node(:send) do |send_node|
      if send_node.children[1].to_s == 'queue_as'
        return send_node.children[2].children[0]
      end
    end
    'default'
  end
  
  def get_job_callbacks(node)
    callbacks = []
    %w(before_enqueue after_enqueue before_perform after_perform).each do |callback|
      node.each_node(:send) do |send_node|
        if send_node.children[1].to_s == callback
          callbacks << {
            type: callback,
            method: send_node.children[2].children[0]
          }
        end
      end
    end
    callbacks
  end
  
  def get_helper_methods(node)
    methods = []
    node.children[2].each_node(:def) do |method_node|
      methods << method_node.children[0]
    end
    methods
  end
  
  def get_concern_methods(node)
    methods = []
    node.children[2].each_node(:def) do |method_node|
      methods << method_node.children[0]
    end
    methods
  end
  
  def get_concern_callbacks(node)
    callbacks = []
    %w(included extended).each do |callback|
      node.each_node(:block) do |block_node|
        if block_node.children[0].children[1].to_s == callback
          callbacks << {
            type: callback,
            methods: get_block_methods(block_node)
          }
        end
      end
    end
    callbacks
  end
  
  def get_block_methods(node)
    methods = []
    node.each_node(:def) do |method_node|
      methods << method_node.children[0]
    end
    methods
  end
  
  def get_service_methods(node)
    methods = []
    node.children[2].each_node(:def) do |method_node|
      methods << method_node.children[0]
    end
    methods
  end
  
  def get_service_dependencies(node)
    dependencies = []
    node.each_node(:send) do |send_node|
      if send_node.children[1].to_s == 'include' || send_node.children[1].to_s == 'extend'
        dependencies << send_node.children[2].children[1]
      end
    end
    dependencies
  end
  
  def get_validator_attributes(node)
    attributes = []
    node.each_node(:send) do |send_node|
      if send_node.children[1].to_s == 'validates'
        attributes << send_node.children[2].children[0]
      end
    end
    attributes
  end
  
  def get_validator_methods(node)
    methods = []
    node.children[2].each_node(:def) do |method_node|
      methods << method_node.children[0]
    end
    methods
  end
  
  def get_serializer_attributes(node)
    attributes = []
    node.each_node(:send) do |send_node|
      if send_node.children[1].to_s == 'attributes'
        attributes.concat(send_node.children[2..-1].map { |c| c.children[0] })
      end
    end
    attributes
  end
  
  def get_serializer_associations(node)
    associations = []
    %w(belongs_to has_many has_one).each do |assoc|
      node.each_node(:send) do |send_node|
        if send_node.children[1].to_s == assoc
          associations << {
            type: assoc,
            name: send_node.children[2].children[0]
          }
        end
      end
    end
    associations
  end
  
  def on_send(node)
    if node.children[1].to_s == 'require' || node.children[1].to_s == 'require_relative'
      @dependencies[node.children[2].children[0]] = []
    end
    
    @complexity += 1 if %w(if unless case while until for).include?(node.children[1].to_s)
    
    process_all(node.children)
  end
  
  def on_if(node)
    @complexity += 1
    process_all(node.children)
  end
  
  def on_while(node)
    @complexity += 1
    process_all(node.children)
  end
  
  def on_until(node)
    @complexity += 1
    process_all(node.children)
  end
  
  def on_for(node)
    @complexity += 1
    process_all(node.children)
  end
  
  def on_case(node)
    @complexity += 1
    process_all(node.children)
  end
  
  def on_rescue(node)
    @complexity += 1
    process_all(node.children)
  end
end

def analyze_code(code)
  begin
    buffer = Parser::Source::Buffer.new('(string)')
    buffer.source = code
    
    parser = Parser::CurrentRuby.new
    ast = parser.parse(buffer)
    
    analyzer = RailsAnalyzer.new
    analyzer.process(ast)
    
    // Yorum satırlarını say
    comment_lines = code.lines.count { |line| line.strip.start_with?('#') }
    
    {
      success: true,
      symbols: analyzer.symbols,
      dependencies: analyzer.dependencies,
      complexity: analyzer.complexity,
      lines_of_code: code.lines.count,
      comment_lines: comment_lines
    }
  rescue => e
    {
      success: false,
      error: e.message
    }
  end
end

code = STDIN.read
result = analyze_code(code)
puts JSON.generate(result)`;

            // Ruby process'ini başlat
            const rubyProcess = spawn('ruby', ['-c', rubyScript]);
            
            // Kodu gönder
            rubyProcess.stdin.write(content);
            rubyProcess.stdin.end();

            // Sonucu al
            const output = await new Promise<string>((resolve, reject) => {
                let result = '';
                rubyProcess.stdout.on('data', (data) => {
                    result += data.toString();
                });
                rubyProcess.stderr.on('data', (data) => {
                    console.error('Rails analiz hatası:', data.toString());
                });
                rubyProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve(result);
                    } else {
                        reject(new Error('Rails analizi başarısız oldu'));
                    }
                });
            });

            const analysisResult = JSON.parse(output);
            
            if (!analysisResult.success) {
                throw new Error(analysisResult.error);
            }

            // Sonuçları VSCode formatına dönüştür
            return {
                ast: this.createASTNode(analysisResult),
                symbols: this.createSymbolsMap(analysisResult.symbols),
                dependencies: this.createDependenciesMap(analysisResult.dependencies),
                metrics: this.createMetrics(analysisResult)
            };

        } catch (error) {
            console.error('Rails analiz hatası:', error);
            throw error;
        }
    }

    private createASTNode(result: any): SemanticNode {
        return {
            type: 'Module',
            name: 'root',
            location: new vscode.Location(
                vscode.Uri.file(''),
                new vscode.Range(0, 0, 0, 0)
            ),
            children: []
        };
    }

    private createSymbolsMap(symbols: any): Map<string, SemanticNode> {
        const result = new Map<string, SemanticNode>();
        
        for (const [name, info] of Object.entries<any>(symbols)) {
            result.set(name, {
                type: info.type,
                name: name,
                location: new vscode.Location(
                    vscode.Uri.file(''),
                    new vscode.Range(
                        info.line - 1,
                        info.column,
                        info.end_line - 1,
                        info.end_column
                    )
                ),
                documentation: info.documentation
            });
        }
        
        return result;
    }

    private createDependenciesMap(dependencies: any): Map<string, string[]> {
        return new Map(Object.entries(dependencies));
    }

    private createMetrics(result: any): CodeMetrics {
        return {
            complexity: result.complexity,
            linesOfCode: result.lines_of_code,
            commentLines: result.comment_lines,
            dependencies: Object.keys(result.dependencies || {}).length,
            maintainabilityIndex: this.calculateMaintainabilityIndex(
                result.complexity,
                result.lines_of_code,
                result.comment_lines
            )
        };
    }

    private calculateMaintainabilityIndex(
        complexity: number,
        linesOfCode: number,
        commentLines: number
    ): number {
        const avgComplexity = complexity / (linesOfCode || 1);
        const commentRatio = commentLines / (linesOfCode || 1);
        
        return Math.max(0, Math.min(100,
            171 -
            5.2 * Math.log(avgComplexity || 1) -
            0.23 * Math.log(linesOfCode || 1) -
            16.2 * Math.log(commentRatio || 0.01)
        ));
    }

    public dispose(): void {
        this.analysisCache.clear();
    }
} 